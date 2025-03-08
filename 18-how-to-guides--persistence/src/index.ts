import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import {
  Annotation,
  END,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import * as fs from "fs/promises";
import { z } from "zod";

(async () => {
  const RESULT: (object | string)[] = [];

  /* ---------------------------------- State --------------------------------- */

  const GraphState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
      reducer: (x, y) => x.concat(y),
    }),
  });

  /* ---------------------------------- tools --------------------------------- */

  const searchTool = tool(
    ({ query }) => {
      return "Cold, with a low of 13 ℃";
    },
    {
      name: "search",
      description:
        "Use to surf the web, fetch current information, check the weather, and retrieve other information.",
      schema: z.object({
        query: z.string().describe("The query to use in your search."),
      }),
    }
  );

  RESULT.push(await searchTool.invoke({ query: "What's the weather like?" }));

  const tools = [searchTool];

  /* -------------------------------- toolNode -------------------------------- */

  const toolNode = new ToolNode(tools);

  /* ---------------------------------- model --------------------------------- */

  const model = new ChatOpenAI({ model: "gpt-4o" });
  const boundModel = model.bindTools(tools);

  /* ---------------------------------- Nodes --------------------------------- */

  const callNode = async (
    state: typeof GraphState.State,
    config?: RunnableConfig
  ) => {
    const { messages } = state;
    const response = await boundModel.invoke(messages, config);
    return { messages: [response] };
  };

  /* ---------------------------------- edges --------------------------------- */

  const routeMessageEdge = (state: typeof GraphState.State) => {
    const { messages } = state;
    const lastMessage = messages[messages.length - 1] as AIMessage;
    if (!lastMessage.tool_calls?.length) {
      return END;
    }
    return "tools";
  };

  /* ---------------------------- Workflow & Graph ---------------------------- */

  const workflow = new StateGraph(GraphState)
    .addNode("toolNode", toolNode)
    .addNode("callNode", callNode)
    .addEdge(START, "callNode")
    .addConditionalEdges("callNode", routeMessageEdge, [END, "toolNode"])
    .addEdge("toolNode", "callNode");

  const graph = workflow.compile();

  // prettier-ignore
  try {
    const buffer = (await (await graph.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
    await fs.writeFile("./diagram-1.png", Buffer.from(await buffer));
  } catch (error) {
    console.error("Failed to fetch and write the diagram:", error);
  }

  /* --------------------------------- invoke1 --------------------------------- */

  let inputs = {
    messages: [new HumanMessage("Hi I'm Yu, nice to meet you.")],
  };

  for await (const { messages } of await graph.stream(inputs, {
    streamMode: "values",
  })) {
    let msg = messages[messages?.length - 1];
    if (msg?.content) {
      console.log(msg.getType(), " >> ", msg.content);
      RESULT.push([msg.getType(), " >> ", msg.content]);
    } else if (msg?.tool_calls?.length > 0) {
      console.log(msg.getType(), " >> ", msg.tool_calls);
      RESULT.push([msg.getType(), " >> ", msg.tool_calls]);
    } else {
      console.log(msg.getType(), " >> ", msg);
      RESULT.push([msg.getType(), " >> ", msg]);
    }
    console.log("-----\n");
  }

  /* --------------------------------- invoke2 -------------------------------- */
  inputs = {
    messages: [new HumanMessage("Remember my name?")],
  };

  for await (const { messages } of await graph.stream(inputs, {
    streamMode: "values",
  })) {
    let msg = messages[messages?.length - 1];
    if (msg?.content) {
      console.log(msg.getType(), " >> ", msg.content);
      RESULT.push([msg.getType(), " >> ", msg.content]);
    } else if (msg?.tool_calls?.length > 0) {
      console.log(msg.getType(), " >> ", msg.tool_calls);
      RESULT.push([msg.getType(), " >> ", msg.tool_calls]);
    } else {
      console.log(msg.getType(), " >> ", msg);
      RESULT.push([msg.getType(), " >> ", msg]);
    }
    console.log("-----\n");
  }

  /* ------------------------------- Add Memory ------------------------------- */
  const memory = new MemorySaver();
  const persistentGraph = workflow.compile({ checkpointer: memory });

  let config = { configurable: { thread_id: "conversation-num-1" } };
  inputs = {
    messages: [new HumanMessage("Hi I'm Jo, nice to meet you.")],
  };
  for await (const { messages } of await persistentGraph.stream(inputs, {
    ...config,
    streamMode: "values",
  })) {
    let msg = messages[messages?.length - 1];
    if (msg?.content) {
      console.log(msg.getType(), " >> ", msg.content);
      RESULT.push([msg.getType(), " >> ", msg.content]);
    } else if (msg?.tool_calls?.length > 0) {
      console.log(msg.getType(), " >> ", msg.tool_calls);
      RESULT.push([msg.getType(), " >> ", msg.tool_calls]);
    } else {
      console.log(msg.getType(), " >> ", msg);
      RESULT.push([msg.getType(), " >> ", msg]);
    }
    console.log("-----\n");
  }

  inputs = {
    messages: [new HumanMessage("Remember my name?")],
  };

  for await (const { messages } of await persistentGraph.stream(inputs, {
    ...config,
    streamMode: "values",
  })) {
    let msg = messages[messages?.length - 1];
    if (msg?.content) {
      console.log(msg.getType(), " >> ", msg.content);
      RESULT.push([msg.getType(), " >> ", msg.content]);
    } else if (msg?.tool_calls?.length > 0) {
      console.log(msg.getType(), " >> ", msg.tool_calls);
      RESULT.push([msg.getType(), " >> ", msg.tool_calls]);
    } else {
      console.log(msg.getType(), " >> ", msg);
      RESULT.push([msg.getType(), " >> ", msg]);
    }
    console.log("-----\n");
  }

  /* ------------------------ New Conversational Thread ----------------------- */
  config = { configurable: { thread_id: "conversation-2" } };

  inputs = {
    messages: [new HumanMessage("you forgot?")],
  };

  for await (const { messages } of await persistentGraph.stream(inputs, {
    ...config,
    streamMode: "values",
  })) {
    let msg = messages[messages?.length - 1];
    if (msg?.content) {
      console.log(msg.getType(), " >> ", msg.content);
      RESULT.push([msg.getType(), " >> ", msg.content]);
    } else if (msg?.tool_calls?.length > 0) {
      console.log(msg.getType(), " >> ", msg.tool_calls);
      RESULT.push([msg.getType(), " >> ", msg.tool_calls]);
    } else {
      console.log(msg.getType(), " >> ", msg);
      RESULT.push([msg.getType(), " >> ", msg]);
    }
    console.log("-----\n");
  }

  /* --------------------------------- Result --------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
