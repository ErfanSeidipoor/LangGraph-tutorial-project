import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { Runnable, RunnableConfig } from "@langchain/core/runnables";
import {
  DynamicStructuredTool,
  StructuredTool,
  tool,
} from "@langchain/core/tools";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { createReactAgent, ToolNode } from "@langchain/langgraph/prebuilt";
import { createCanvas } from "canvas";

import * as d3 from "d3";
import * as fs from "fs";
import { z } from "zod";

(async () => {
  /* ---------------------------------- State --------------------------------- */
  const AgentState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
      reducer: (x, y) => y ?? x ?? [],
      default: () => [],
    }),
    next: Annotation<string>({
      reducer: (x, y) => y ?? x ?? END,
      default: () => END,
    }),
  });

  /* ---------------------------------- Tools --------------------------------- */

  const chartTool = new DynamicStructuredTool({
    name: "generate_bar_chart",
    description:
      "Generates a bar chart from an array of data points using D3.js and displays it for the user.",
    schema: z.object({
      data: z
        .object({
          label: z.string(),
          value: z.number(),
        })
        .array(),
    }),
    func: async ({ data }) => {
      const width = 500;
      const height = 500;
      const margin = { top: 20, right: 30, bottom: 30, left: 40 };

      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");

      const x = d3
        .scaleBand()
        .domain(data.map((d) => d.label))
        .range([margin.left, width - margin.right])
        .padding(0.1);

      const y = d3
        .scaleLinear()
        .domain([0, d3.max(data, (d) => d.value) ?? 0])
        .nice()
        .range([height - margin.bottom, margin.top]);

      const colorPalette = [
        "#e6194B",
        "#3cb44b",
        "#ffe119",
        "#4363d8",
        "#f58231",
        "#911eb4",
        "#42d4f4",
        "#f032e6",
        "#bfef45",
        "#fabebe",
      ];

      data.forEach((d, idx) => {
        ctx.fillStyle = colorPalette[idx % colorPalette.length];
        ctx.fillRect(
          x(d.label) ?? 0,
          y(d.value),
          x.bandwidth(),
          height - margin.bottom - y(d.value)
        );
      });

      ctx.beginPath();
      ctx.strokeStyle = "black";
      ctx.moveTo(margin.left, height - margin.bottom);
      ctx.lineTo(width - margin.right, height - margin.bottom);
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      x.domain().forEach((d) => {
        const xCoord = (x(d) ?? 0) + x.bandwidth() / 2;
        ctx.fillText(d, xCoord, height - margin.bottom + 6);
      });

      ctx.beginPath();
      ctx.moveTo(margin.left, height - margin.top);
      ctx.lineTo(margin.left, height - margin.bottom);
      ctx.stroke();

      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      const ticks = y.ticks();
      ticks.forEach((d) => {
        const yCoord = y(d); // height - margin.bottom - y(d);
        ctx.moveTo(margin.left, yCoord);
        ctx.lineTo(margin.left - 6, yCoord);
        ctx.stroke();
        ctx.fillText(d.toString(), margin.left - 8, yCoord);
      });

      fs.writeFileSync("./chart.png", Buffer.from(await canvas.toBuffer()));
      return "Chart has been generated and displayed to the user!";
    },
  });

  const tavilyTool = new TavilySearchResults();

  /* ---------------------------- Agent Supervisor ---------------------------- */

  const members: ["researcherNode", "chartGeneratorNode"] = [
    "researcherNode",
    "chartGeneratorNode",
  ];

  const systemPrompt =
    " You are a supervisor tasked with managing a conversation between the" +
    " following workers: {members}. Given the following user request," +
    " respond with the worker to act next. Each worker will perform a" +
    " task and respond with their results and status. When finished," +
    " respond with FINISH.";

  const options = [...members, END];

  const routingTool = {
    name: "route",
    description: "Select the next role.",
    schema: z.object({
      next: z.enum([END, ...members]),
    }),
  };

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", systemPrompt],
    new MessagesPlaceholder("messages"),
    [
      "human",
      "Given the conversation above, who should act next ? Or should we FINISH? Select one of {options}",
    ],
  ]);

  const formattedPrompt = await prompt.partial({
    options: options.join(", "),
    members: members.join(", "),
  });

  const llm = new ChatGoogleGenerativeAI({ model: "gemini-1.5-pro" });

  const supervisorChain = formattedPrompt
    .pipe(llm.bindTools([routingTool], { tool_choice: "route" }))
    .pipe((x) => {
      console.log("x > ", x);
      // @ts-ignore
      return x.tool_calls[0].args;
    });

  const response1 = await supervisorChain.invoke({
    messages: [
      new HumanMessage({
        content: "write a report on birds.",
      }),
    ],
  });

  const response2 = await supervisorChain.invoke({
    messages: [
      new HumanMessage({
        content:
          "generate a bar chart fot this data [A,B,C,D,E,F] [123, 123, 432, 654, 234, 542]",
      }),
    ],
  });

  console.log({ response1, response2 });

  /* ----------------------------- researcherNode ----------------------------- */

  const researcherNode = async (
    state: typeof AgentState.State,
    config?: RunnableConfig
  ) => {
    const researcherAgent = createReactAgent({
      llm,
      tools: [tavilyTool],
      stateModifier: new SystemMessage(
        "You are a web researcher. You may use the Tavily search engine to search the web for" +
          " important information, so the Chart Generator in your team can make useful plots."
      ),
    });

    const result = await researcherAgent.invoke(state, config);
    const lastMessage = result.messages[result.messages.length - 1];

    return {
      messages: [new HumanMessage({ content: lastMessage.content })],
    };
  };

  /* --------------------------- chartGeneratorNode --------------------------- */

  const chartGeneratorNode = async (
    state: typeof AgentState.State,
    config?: RunnableConfig
  ) => {
    const chartGeneratorAgent = createReactAgent({
      llm,
      tools: [chartTool],
      stateModifier: new SystemMessage(
        "You excel at generating bar charts. Use the researcher's information to generate the charts."
      ),
    });

    const result = await chartGeneratorAgent.invoke(state, config);
    const lastMessage = result.messages[result.messages.length - 1];

    return {
      messages: [
        new HumanMessage({
          content: lastMessage.content,
        }),
      ],
    };
  };

  /* ---------------------------------- Graph --------------------------------- */

  const workflow = new StateGraph(AgentState)
    .addNode("researcherNode", researcherNode)
    .addNode("chartGeneratorNode", chartGeneratorNode)
    .addNode("supervisorChain", supervisorChain);

  for (const member of members) {
    workflow.addEdge(member, "supervisorChain");
  }

  workflow.addConditionalEdges("supervisorChain", (x) => x.next);

  workflow.addEdge(START, "supervisorChain");

  const graph = workflow.compile();

  // prettier-ignore
  const buffer = (await (await graph.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  fs.writeFileSync("./diagram-2.png", Buffer.from(await buffer));

  /* --------------------------------- output --------------------------------- */

  let streamResults = graph.stream(
    {
      messages: [
        new HumanMessage({
          content: "What were the 3 most popular tv shows in 2023?",
        }),
      ],
    },
    { recursionLimit: 100 }
  );

  for await (const output of await streamResults) {
    if (!output?.__end__) {
      console.log(output);
      console.log("----");
    }
  }
})();
