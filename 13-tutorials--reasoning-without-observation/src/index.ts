import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import { ChatPromptTemplate } from "@langchain/core/prompts";

import {
  Annotation,
  END,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";

import { RunnableConfig } from "@langchain/core/runnables";
import * as fs from "fs/promises";

(async () => {
  const RESULT: (object | string)[] = [];

  const model = new ChatOpenAI({
    model: "gpt-4o",
  });

  /* ------------------------------- GraphState ------------------------------- */

  const GraphState = Annotation.Root({
    task: Annotation<string>({
      reducer: (x, y) => y ?? x,
      default: () => "",
    }),
    planString: Annotation<string>({
      reducer: (x, y) => y && x,
      default: () => "",
    }),
    steps: Annotation<string[][]>({
      reducer: (x, y) => x.concat(y),
      default: () => [],
    }),
    results: Annotation<{
      [key: string]: string;
    }>({
      reducer: (x, y) => ({ ...x, ...y }),
    }),
    result: Annotation<string>({
      reducer: (x, y) => y ?? x,
      default: () => "",
    }),
  });

  /* --------------------------------- Planner -------------------------------- */

  const template = `For the following task, make plans that can solve the problem step by step. For each plan, indicate
      which external tool together with tool input to retrieve evidence. You can store the evidence into a 
      variable #E that can be called by later tools. (Plan, #E1, Plan, #E2, Plan, ...)

      Tools can be one of the following:
      (1) Google[input]: Worker that searches results from Google. Useful when you need to find short
      and succinct answers about a specific topic. The input should be a search query.
      (2) LLM[input]: A pre-trained LLM like yourself. Useful when you need to act with general 
      world knowledge and common sense. Prioritize it when you are confident in solving the problem
      yourself. Input can be any instruction.

      For example,
      Task: Thomas, Toby, and Rebecca worked a total of 157 hours in one week. Thomas worked x 
      hours. Toby worked 10 hours less than twice what Thomas worked, and Rebecca worked 8 hours 
      less than Toby. How many hours did Rebecca work? 
      Plan: Given Thomas worked x hours, translate the problem into algebraic expressions and solve with Wolfram Alpha.
      #E1 = WolframAlpha[Solve x + (2x - 10) + ((2x - 10) - 8) = 157]
      Plan: Find out the number of hours Thomas worked.
      #E2 = LLM[What is x, given #E1]
      Plan: Calculate the number of hours Rebecca worked.
      #E3 = Calculator[(2 * #E2 - 10) - 8]

      Important!
      Variables/results MUST be referenced using the # symbol!
      The plan will be executed as a program, so no coreference resolution apart from naive variable replacement is allowed.
      The ONLY way for steps to share context is by including #E<step> within the arguments of the tool.

      Begin! 
      Describe your plans with rich details. Each Plan should be followed by only one #E.

      Task: {task}
    `;

  const promptTemplate = ChatPromptTemplate.fromMessages([["human", template]]);

  const planner = promptTemplate.pipe(model);

  const task =
    "what is the hometown of the winner of the 2023 australian open?";
  const plannerResponse = await planner.invoke({ task });

  RESULT.push(plannerResponse);

  const regexPattern = new RegExp(
    "Plan\\s*\\d*:\\s*([^#]+)\\s*(#E\\d+)\\s*=\\s*(\\w+)\\s*\\[([^\\]]+)\\]",
    "g"
  );

  async function PlannerNode(
    state: typeof GraphState.State,
    config?: RunnableConfig
  ) {
    console.log("---GET PLAN---");

    const task = state.task;
    const result = await planner.invoke({ task }, config);
    // Find all matches in the sample text.
    const matches = result.content.toString().matchAll(regexPattern);
    let steps: string[][] = [];
    for (const match of matches) {
      const item = [match[1], match[2], match[3], match[4], match[0]];
      if (item.some((i) => i === undefined)) {
        throw new Error("Invalid match");
      }
      steps.push(item as string[]);
    }

    RESULT.push({ "PlannerNode > steps": steps });

    return {
      steps,
      planString: result.content.toString(),
    };
  }

  /* -------------------------------- Executor -------------------------------- */

  const searchTool = new TavilySearchResults();

  const getCuurentTask = (state: typeof GraphState.State) => {
    if (!state.results) {
      return 1;
    }
    if (Object.entries(state.results).length === state.steps.length) {
      return null;
    }

    return Object.entries(state.results).length + 1;
  };

  const parseResult = (input: unknown) => {
    if (typeof input === "string") {
      const parsedInput = JSON.parse(input);
      if (Array.isArray(parsedInput) && "content" in parsedInput[0]) {
        return parsedInput.map(({ content }) => content).join("\n");
      }
    }

    if (input && typeof input === "object" && "content" in input) {
      const { content } = input;
      return content;
    }

    throw new Error("Invalid Input received");
  };

  async function toolExecutionNode(
    state: typeof GraphState.State,
    config?: RunnableConfig
  ) {
    console.log("---EXECUTE TOOL---");

    const step = getCuurentTask(state);

    if (step === null) {
      throw new Error("No Current Task Found");
    }

    const [_, stepName, tool, toolInputTemplate] = state.steps[step - 1];
    let toolInput = toolInputTemplate;
    const results = state.results || {};

    for (const [k, v] of Object.entries(results)) {
      toolInput = toolInput.replace(k, v);
    }

    let result;
    if (tool === "Google") {
      result = await searchTool.invoke(toolInput, config);
    } else if (tool === "LLM") {
      result = await model.invoke(toolInput, config);
    } else {
      throw new Error("Invalid tool specified");
    }
    results[stepName] = JSON.stringify(parseResult(result), null, 2);

    RESULT.push({
      toolExecutionNode: {
        step,
        stepName,
        tool,
        toolInputTemplate,
        toolInput,
        results,
      },
    });
    console.log({
      toolExecutionNode: {
        step,
        stepName,
        tool,
        toolInputTemplate,
        toolInput,
        results,
      },
    });

    return { results };
  }

  /* --------------------------------- Solver --------------------------------- */

  const solvePrompt = ChatPromptTemplate.fromTemplate(`
    Solve the following task or problem. To solve the problem, we have made step-by-step Plan and
    retrieved corresponding Evidence to each Plan. Use them with caution since long evidence might
    contain irrelevant information.
    
    {plan}
    
    Now solve the question or task according to provided Evidence above. Respond with the answer
    directly with no extra words.
    
    Task: {task}
    Response:
  `);

  async function solverNode(
    state: typeof GraphState.State,
    config?: RunnableConfig
  ) {
    console.log("---SOLVE---");
    RESULT.push({ "solverNode > state.steps:": state.steps });
    RESULT.push({ "solverNode > state.results:": state.results });

    let plan = "";
    const _results = state.results || {};
    for (let [_plan, stepName, tool, toolInput] of state.steps) {
      for (const [k, v] of Object.entries(_results)) {
        toolInput = toolInput.replace(k, v);
      }
      plan += `Plan: ${_plan}\n${stepName} = ${tool}[${toolInput}]\n`;
    }
    const model = new ChatOpenAI({
      temperature: 0,
      model: "gpt-4o",
    });
    const result = await solvePrompt
      .pipe(model)
      .invoke({ plan, task: state.task }, config);

    RESULT.push({ "solverNode > state.result:": result.content.toString() });
    return {
      result: result.content.toString(),
    };
  }

  /* ------------------------------ Define Graph ------------------------------ */

  const routeCondittionEdge = (state: typeof GraphState.State) => {
    console.log("---ROUTE TASK---");
    const _step = getCuurentTask(state);
    if (_step === null) {
      return "solverNode";
    }
    return "toolExecutionNode";
  };

  const workflow = new StateGraph(GraphState)
    .addNode("PlannerNode", PlannerNode)
    .addNode("toolExecutionNode", toolExecutionNode)
    .addNode("solverNode", solverNode)
    .addEdge("PlannerNode", "toolExecutionNode")
    .addEdge("solverNode", END)
    .addConditionalEdges("toolExecutionNode", routeCondittionEdge, [
      "toolExecutionNode",
      "solverNode",
    ])
    .addEdge(START, "PlannerNode");

  // Compile
  const app = workflow.compile({ checkpointer: new MemorySaver() });

  /* --------------------------------- Invoke --------------------------------- */

  const threadConfig = { configurable: { thread_id: "123" } };
  let finalResult;
  const stream = await app.stream(
    {
      task: "what is the hometown of the winner of the 2023 australian open?",
    },
    threadConfig
  );
  for await (const item of stream) {
    console.log(item);
    console.log("-----");
    finalResult = item;
  }

  // prettier-ignore
  fs.writeFile("RESULT.json",JSON.stringify(RESULT, null, 2),"utf8");

  // prettier-ignore
  const buffer2 = (await (await app.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  fs.writeFile("./diagram-1.png", Buffer.from(await buffer2));
})();
