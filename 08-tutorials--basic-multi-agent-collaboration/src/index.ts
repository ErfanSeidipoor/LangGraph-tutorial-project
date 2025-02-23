import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { StructuredTool, tool } from "@langchain/core/tools";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import { Annotation } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import * as tslab from "tslab";
import { createCanvas } from "canvas";
import { z } from "zod";
import * as fs from "fs";
import { END, START, StateGraph } from "@langchain/langgraph";
import { Runnable, RunnableConfig } from "@langchain/core/runnables";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import * as d3 from "d3";

(async () => {
  async function createAgent({
    llm,
    tools,
    systemMessage,
  }: {
    llm: ChatOpenAI;
    tools: StructuredTool[];
    systemMessage: string;
  }) {
    const toolNames = tools.map((tool) => tool.name).join(", ");
    const formattedTools = tools.map((tool) => convertToOpenAITool(tool));

    let prompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        "You are a helpful AI assistant, collaborating with other assistants." +
          " Use the provided tools to progress towards answering the question." +
          " If you are unable to fully answer, that's OK, another assistant with different tools " +
          " will help where you left off. Execute what you can to make progress." +
          " If you or any of the other assistants have the final answer or deliverable," +
          " prefix your response with FINAL ANSWER so the team knows to stop." +
          " You have access to the following tools: {tool_names}.\n{system_message}",
      ],
      new MessagesPlaceholder("messages"),
    ]);

    prompt = await prompt.partial({
      system_message: systemMessage,
      tool_names: toolNames,
    });

    return prompt.pipe(llm.bind({ tools: formattedTools }));
  }

  const AgentState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
      reducer: (x, y) => x.concat(y),
    }),
    sender: Annotation<string>({
      reducer: (x, y) => y ?? x ?? "user",
      default: () => "user",
    }),
  });

  /* ---------------------------------- tools --------------------------------- */

  const chartTool = tool(
    async ({ data }) => {
      console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>", {
        data,
      });

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
        .domain([0, d3.max(data, (d) => Number(d.value)) ?? 0])
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
          y(Number(d.value)),
          x.bandwidth(),
          height - margin.bottom - y(Number(d.value))
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
      tslab.display.png(canvas.toBuffer());
      fs.writeFileSync("./chart.png", Buffer.from(await canvas.toBuffer()));

      console.log("Chart has been generated and displayed to the user!");

      return "Chart has been generated and displayed to the user!";
    },
    {
      name: "generate_bar_chart",
      description:
        "Generates a bar chart from an array of data points using D3.js and displays it for the user.",
      schema: z.object({
        data: z
          .object({
            label: z.string(),
            value: z.string(),
          })
          .array(),
      }),
    }
  );

  const tavilyTool = new TavilySearchResults();

  async function runAgentNode(props: {
    state: typeof AgentState.State;
    agent: Runnable;
    name: string;
    config?: RunnableConfig;
  }) {
    const { state, agent, name, config } = props;

    let result = await agent.invoke(state, config);

    if (!result.tool_calls || result.tool_calls.length === 0) {
      result = new HumanMessage({ ...result, name: name });
    }

    return {
      messages: [result],
      sender: name,
    };
  }

  const llm = new ChatOpenAI({ model: "gpt-3.5-turbo" });

  /* ---------------------------------- Nodes --------------------------------- */

  const researchAgent = await createAgent({
    llm,
    tools: [tavilyTool],
    systemMessage:
      "You should provide accurate data for the chart generator to use.",
  });

  async function researchNode(
    state: typeof AgentState.State,
    config?: RunnableConfig
  ) {
    return runAgentNode({
      state,
      agent: researchAgent,
      name: "researchNode",
      config,
    });
  }

  const chartAgent = await createAgent({
    llm,
    tools: [chartTool],
    systemMessage: "Any charts you display will be visible by the user",
  });

  async function chartNode(state: typeof AgentState.State) {
    return runAgentNode({
      state,
      agent: chartAgent,
      name: "chartNode",
    });
  }

  const researchResults = await researchNode({
    messages: [new HumanMessage("Research the US primaries in 2024")],
    sender: "User",
  });

  const tools = [tavilyTool, chartTool];

  const toolNode = new ToolNode<typeof AgentState.State>(tools);

  function routerEdge(state: typeof AgentState.State) {
    const messages = state.messages;
    const lastMessage = messages[messages.length - 1] as AIMessage;

    if (lastMessage?.tool_calls && lastMessage.tool_calls.length > 0) {
      return "toolNode";
    }

    if (
      typeof lastMessage.content === "string" &&
      lastMessage.content.includes("FINAL ANSWER")
    ) {
      return "end";
    }
    return "continue";
  }

  /* ---------------------------------- Graph --------------------------------- */

  const workflow = new StateGraph(AgentState)
    .addNode("researchNode", researchNode)
    .addNode("chartNode", chartNode)
    .addNode("toolNode", toolNode)
    .addEdge(START, "researchNode")
    .addConditionalEdges("researchNode", routerEdge, {
      continue: "chartNode",
      toolNode: "toolNode",
      end: END,
    })
    .addConditionalEdges("chartNode", routerEdge, {
      continue: "researchNode",
      toolNode: "toolNode",
      end: END,
    })
    .addConditionalEdges("toolNode", (x) => x.sender, {
      researchNode: "researchNode",
      chartNode: "chartNode",
    });
  const graph = workflow.compile();

  // prettier-ignore
  const buffer = (await (await graph.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  fs.writeFileSync("./diagram-2.png", Buffer.from(await buffer));

  const streamResults = await graph.stream(
    {
      messages: [
        new HumanMessage({
          content: "Generate a bar chart of the US gdp over the past 3 years.",
        }),
      ],
    },
    { recursionLimit: 150 }
  );

  const prettifyOutput = (output: Record<string, any>) => {
    const keys = Object.keys(output);
    const firstItem = output[keys[0]];

    if ("messages" in firstItem && Array.isArray(firstItem.messages)) {
      const lastMessage = firstItem.messages[firstItem.messages.length - 1];
      console.dir(
        {
          type: lastMessage._getType(),
          content: lastMessage.content,
          tool_calls: lastMessage.tool_calls,
        },
        { depth: null }
      );
    }

    if ("sender" in firstItem) {
      console.log({
        sender: firstItem.sender,
      });
    }
  };

  for await (const output of await streamResults) {
    console.log({ output });

    if (!output?.__end__) {
      prettifyOutput(output);
      console.log("----");
    }
  }
})();
