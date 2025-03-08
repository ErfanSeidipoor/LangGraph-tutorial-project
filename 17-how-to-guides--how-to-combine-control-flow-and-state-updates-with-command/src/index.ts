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

  const nodeA = async (state: typeof StateAnnotation.State) => {
    console.log("Called nodeA");
    RESULT.push("Called nodeA ");
    return new Command({
      update: {
        foo: "a",
      },
      goto: Math.random() > 0.5 ? "nodeB" : "nodeC",
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

  const graph = new StateGraph(StateAnnotation)
    .addNode("nodeA", nodeA, {
      ends: ["nodeB", "nodeC"],
    })
    .addNode("nodeB", nodeB)
    .addNode("nodeC", nodeC)
    .addEdge(START, "nodeA")
    .addEdge("nodeB", END)
    .addEdge("nodeC", END)
    .compile();

  // prettier-ignore
  const buffer = (await (await graph.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  fs.writeFile("./diagram-1.png", Buffer.from(await buffer));

  /* --------------------------------- Invoke --------------------------------- */

  await graph.invoke({ foo: "" });
  // prettier-ignore
  fs.writeFile("RESULT.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
