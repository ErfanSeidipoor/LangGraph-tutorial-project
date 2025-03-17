import {
  Annotation,
  END,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";

import * as fs from "fs/promises";

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

  const currState = await graph.getState(graphStateConfig);
  console.log("Current state", currState.values);
  RESULT.push({ "Current state": currState.values });

  await graph.updateState(graphStateConfig, { input: "hello universe!" });

  const updatedState = await graph.getState(graphStateConfig);
  console.log("Updated state", updatedState.values);
  RESULT.push({ "Updated state": updatedState.values });

  for await (const event of await graph.stream(null, graphStateConfig)) {
    console.log(`--- ${event.input} ---`);
  }

  // prettier-ignore
  fs.writeFile("RESULT-basic.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
