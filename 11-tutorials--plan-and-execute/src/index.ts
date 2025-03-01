import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import { HumanMessage } from "@langchain/core/messages";
import { JsonOutputToolsParser } from "@langchain/core/output_parsers/openai_tools";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableConfig } from "@langchain/core/runnables";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { zodToJsonSchema } from "zod-to-json-schema";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";

import * as fs from "fs/promises";
import { z } from "zod";

(async () => {
  const RESULT: (object | string)[] = [];

  /* ---------------------------------- State --------------------------------- */

  const PlanExecuteState = Annotation.Root({
    input: Annotation<string>({
      reducer: (x, y) => y ?? x ?? "",
    }),
    plan: Annotation<string[]>({
      reducer: (x, y) => y ?? x ?? "",
    }),
    pastSteps: Annotation<[string, string][]>({
      reducer: (x, y) => x.concat(y),
    }),
    response: Annotation<string>({
      reducer: (x, y) => y ?? x,
    }),
  });

  /* ---------------------------------- Tools --------------------------------- */

  const tools = [new TavilySearchResults({ maxResults: 3 })];

  /* ----------------------------- Execution Agent ---------------------------- */

  const agentExecutor = createReactAgent({
    llm: new ChatGoogleGenerativeAI({ model: "gemini-1.5-pro" }),
    tools,
  });

  const response1 = await agentExecutor.invoke({
    messages: [new HumanMessage("who is the winner of the us open ?")],
  });

  RESULT.push(response1);

  /* ------------------------------ Planning Step ----------------------------- */

  const plan_JsonSchema = zodToJsonSchema(
    z.object({
      steps: z
        .array(z.string())
        .describe("different steps to follow, should be in sorted order"),
    })
  );

  const planFunction = {
    name: "plan",
    description: "This tool is used to plan the steps to follow",
    parameters: plan_JsonSchema,
  };

  const planTool = {
    type: "function",
    function: planFunction,
  };

  const plannerPrompt = ChatPromptTemplate.fromTemplate(
    `
    For the given objective, come up with simple step by step plan.
    This plan should involve individual tasks, that if executed correctly will yield the correct answer. Do not add this result to the final step should be the final answer. Make sure that each step has tge information needed - do not skip steps.

    objective: {objective}
    `
  );

  const model = new ChatOpenAI({
    modelName: "gpt-4o",
  }).withStructuredOutput(planFunction);

  const planner = plannerPrompt.pipe(model);

  const response2 = await planner.invoke({
    objective: "what is the hometown of the current Australia open winner?",
  });

  RESULT.push(response2);

  /* ------------------------------ Re-Plan Step ------------------------------ */

  const response_JsonSchema = zodToJsonSchema(
    z.object({
      response: z.string().describe("Response to user."),
    })
  );

  const responseTool = {
    type: "function",
    function: {
      name: "response",
      description: "Response to user.",
      parameters: response_JsonSchema,
    },
  };

  const replannerPrompt = ChatPromptTemplate.fromTemplate(
    `For the given objective, come up with a simple step by step plan. 
  This plan should involve individual tasks, that if executed correctly will yield the correct answer. Do not add any superfluous steps.
  The result of the final step should be the final answer. Make sure that each step has all the information needed - do not skip steps.
  
  Your objective was this:
  {input}
  
  Your original plan was this:
  {plan}
  
  You have currently done the follow steps:
  {pastSteps}
  
  Update your plan accordingly. If no more steps are needed and you can return to the user, then respond with that and use the 'response' function.
  Otherwise, fill out the plan.  
  Only add steps to the plan that still NEED to be done. Do not return previously done steps as part of the plan.`
  );

  const parser = new JsonOutputToolsParser();
  const replanner = replannerPrompt
    .pipe(
      new ChatOpenAI({ model: "gpt-4o" }).bindTools([planTool, responseTool])
    )
    .pipe(parser);

  /* ---------------------------- Create the Graph ---------------------------- */

  async function executeNode(
    state: typeof PlanExecuteState.State,
    config?: RunnableConfig
  ): Promise<Partial<typeof PlanExecuteState.State>> {
    const task = state.plan[0];
    const input = {
      messages: [new HumanMessage(task)],
    };
    const { messages } = await agentExecutor.invoke(input, config);

    return {
      pastSteps: [[task, messages[messages.length - 1].content.toString()]],
      plan: state.plan.slice(1),
    };
  }

  async function planNode(
    state: typeof PlanExecuteState.State
  ): Promise<Partial<typeof PlanExecuteState.State>> {
    const plan = await planner.invoke({ objective: state.input });
    return { plan: plan.steps };
  }

  async function replanNode(
    state: typeof PlanExecuteState.State
  ): Promise<Partial<typeof PlanExecuteState.State>> {
    const output = await replanner.invoke({
      input: state.input,
      plan: state.plan.join("\n"),
      pastSteps: state.pastSteps
        .map(([step, result]) => `${step}: ${result}`)
        .join("\n"),
    });
    // @ts-ignore
    const toolCall = output[0];

    if (toolCall.type == "response") {
      return { response: toolCall.args?.response };
    }

    return { plan: toolCall.args?.steps };
  }

  function shouldEnd(state: typeof PlanExecuteState.State) {
    return state.response ? "true" : "false";
  }

  const workflow = new StateGraph(PlanExecuteState)
    .addNode("planNode", planNode)
    .addNode("executeNode", executeNode)
    .addNode("replanNode", replanNode)
    .addEdge(START, "planNode")
    .addEdge("planNode", "executeNode")
    .addEdge("executeNode", "replanNode")
    .addConditionalEdges("replanNode", shouldEnd, {
      true: END,
      false: "executeNode",
    });

  const app = workflow.compile();
  /* --------------------------------- Result --------------------------------- */

  const config = { recursionLimit: 50 };
  const inputs = {
    input: "what is the hometown of the 2024 Australian open winner?",
  };

  for await (const event of await app.stream(inputs, config)) {
    console.log(event);
    RESULT.push(event);
  }

  // prettier-ignore
  fs.writeFile("RESULT.json",JSON.stringify(RESULT, null, 2),"utf8");

  // prettier-ignore
  const buffer2 = (await (await app.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  fs.writeFile("./diagram-1.png", Buffer.from(await buffer2));
})();
