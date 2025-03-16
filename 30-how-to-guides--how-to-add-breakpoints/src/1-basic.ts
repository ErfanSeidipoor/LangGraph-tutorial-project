import {
  Annotation,
  Command,
  END,
  interrupt,
  MemorySaver,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { ToolCall } from "@langchain/core/messages/tool";
import { tool } from "@langchain/core/tools";

import * as fs from "fs/promises";
import { AIMessage, ToolMessage } from "@langchain/core/messages";

(async () => {
  let RESULT: (object | string)[] = [];

  /* ------------------------------- GraphState ------------------------------- */
  const GraphState = Annotation.Root({
    input: Annotation<string>,
  });

  /* ---------------------------------- nodes --------------------------------- */

  const step1 = (state: typeof GraphState.State) => {
    console.log("---Step 1---");
    RESULT.push("---Step 1---");
    return state;
  };

  const step2 = (state: typeof GraphState.State) => {
    console.log("---Step 2---");
    RESULT.push("---Step 2---");
    return state;
  };

  const step3 = (state: typeof GraphState.State) => {
    console.log("---Step 3---");
    RESULT.push("---Step 3---");
    return state;
  };

  const builder = new StateGraph(GraphState)
    .addNode("step1", step1)
    .addNode("step2", step2)
    .addNode("step3", step3)
    .addEdge(START, "step1")
    .addEdge("step1", "step2")
    .addEdge("step2", "step3")
    .addEdge("step3", END);

  const graphStateMemory = new MemorySaver();

  const graph = builder.compile({
    checkpointer: graphStateMemory,
    interruptBefore: ["step3"],
  });

  // prettier-ignore
  const buffer = (await (await graph.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./diagram-basic.png", Buffer.from(await buffer));

  const initialInput = { input: "hello world" };

  const graphStateConfig = {
    configurable: { thread_id: "1" },
    streamMode: "values" as const,
  };

  for await (const event of await graph.stream(
    initialInput,
    graphStateConfig
  )) {
    console.log(`--- ${event.input} ---`);
  }

  console.log("---GRAPH INTERRUPTED---");

  for await (const event of await graph.stream(null, graphStateConfig)) {
    console.log(`--- ${event.input} ---`);
  }

  // prettier-ignore
  fs.writeFile("RESULT-basic.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
