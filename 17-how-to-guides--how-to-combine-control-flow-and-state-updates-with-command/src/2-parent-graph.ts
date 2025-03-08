import {
  Annotation,
  Command,
  END,
  START,
  StateGraph,
} from "@langchain/langgraph";
import * as fs from "fs/promises";

(async () => {
  const RESULT: (object | string)[] = [];

  /* ---------------------------------- State --------------------------------- */

  const StateAnnotation = Annotation.Root({
    foo: Annotation<string>,
  });

  /* ---------------------------------- Nodes --------------------------------- */

  const nodeASubgraph = async (state: typeof StateAnnotation.State) => {
    console.log("Called nodeASubgraph");
    RESULT.push("Called nodeASubgraph ");
    return new Command({
      update: {
        foo: "Sub a",
      },
      goto: Math.random() > 0.5 ? "nodeB" : "nodeC",
      graph: Command.PARENT,
    });
  };

  const nodeB = async (state: typeof StateAnnotation.State) => {
    console.log("Called nodeB");
    RESULT.push("Called nodeB");

    return {
      foo: state.foo + "| B",
    };
  };

  const nodeC = async (state: typeof StateAnnotation.State) => {
    console.log("Called nodeC");
    RESULT.push("Called nodeC");

    return {
      foo: state.foo + "| C",
    };
  };

  /* ---------------------------------- Graph --------------------------------- */

  const subgraph = new StateGraph(StateAnnotation)
    .addNode("nodeASubgraph", nodeASubgraph)
    .addEdge("__start__", "nodeASubgraph")
    .compile();

  const parentGraph = new StateGraph(StateAnnotation)
    .addNode("subgraph", subgraph, { ends: ["nodeB", "nodeC"] })
    .addNode("nodeB", nodeB)
    .addNode("nodeC", nodeC)
    .addEdge("__start__", "subgraph")
    .compile();

  // prettier-ignore
  try {
    const buffer = (await (await parentGraph.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
    await fs.writeFile("./diagram-1.png", Buffer.from(await buffer));
  } catch (error) {
    console.error("Failed to fetch and write the diagram:", error);
  }

  /* --------------------------------- Invoke --------------------------------- */

  await parentGraph.invoke({ foo: "" });
  // prettier-ignore
  fs.writeFile("RESULT-2.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
