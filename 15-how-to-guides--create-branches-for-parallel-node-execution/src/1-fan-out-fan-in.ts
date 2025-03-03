import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import * as fs from "fs/promises";

(async () => {
  const RESULT: (object | string)[] = [];

  const StateAnnotation = Annotation.Root({
    aggregate: Annotation<string[]>({
      reducer: (x, y) => x.concat(y),
    }),
  });

  const nodeA = (state: typeof StateAnnotation.State) => {
    console.log(`Adding I'm A to :${state.aggregate}`);
    RESULT.push(`Adding I'm A to :${state.aggregate}`);
    return { aggregate: ["I'm A"] };
  };

  const nodeB = (state: typeof StateAnnotation.State) => {
    console.log(`Adding I'm B to :${state.aggregate}`);
    RESULT.push(`Adding I'm B to :${state.aggregate}`);
    return { aggregate: ["I'm B"] };
  };

  const nodeC = (state: typeof StateAnnotation.State) => {
    console.log(`Adding I'm C to :${state.aggregate}`);
    RESULT.push(`Adding I'm C to :${state.aggregate}`);
    return { aggregate: ["I'm C"] };
  };

  const nodeD = (state: typeof StateAnnotation.State) => {
    console.log(`Adding I'm D to :${state.aggregate}`);
    RESULT.push(`Adding I'm D to :${state.aggregate}`);
    return { aggregate: ["I'm D"] };
  };

  const builder = new StateGraph(StateAnnotation)
    .addNode("nodeA", nodeA)
    .addNode("nodeB", nodeB)
    .addNode("nodeC", nodeC)
    .addNode("nodeD", nodeD)

    .addEdge(START, "nodeA")
    .addEdge("nodeA", "nodeB")
    .addEdge("nodeA", "nodeC")
    .addEdge("nodeC", "nodeD")
    .addEdge("nodeB", "nodeD")
    .addEdge("nodeD", END);

  const graph = builder.compile();

  const buffer = (
    await (await graph.getGraphAsync()).drawMermaidPng({})
  ).arrayBuffer();
  fs.writeFile("./diagram-1.png", Buffer.from(await buffer));

  /* --------------------------------- Invoke --------------------------------- */

  // Invoke the graph
  const baseResult = await graph.invoke({ aggregate: [] });
  console.log("Base Result: ", baseResult);

  // /* --------------------------------- output --------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
