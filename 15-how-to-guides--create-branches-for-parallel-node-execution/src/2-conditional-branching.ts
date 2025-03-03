import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import * as fs from "fs/promises";

(async () => {
  const RESULT: (object | string)[] = [];

  const ConditionalBranchingAnnotation = Annotation.Root({
    aggregate: Annotation<string[]>({
      reducer: (x, y) => x.concat(y),
    }),
    which: Annotation<string>({
      reducer: (x: string, y: string) => y ?? x,
    }),
  });
  const nodeA2 = (state: typeof ConditionalBranchingAnnotation.State) => {
    console.log(`Adding I'm A to ${state.aggregate}`);
    RESULT.push(`Adding I'm A to :${state.aggregate}`);
    return { aggregate: [`I'm A`] };
  };
  const nodeB2 = (state: typeof ConditionalBranchingAnnotation.State) => {
    console.log(`Adding I'm B to :${state.aggregate}`);
    RESULT.push(`Adding I'm B to :${state.aggregate}`);
    return { aggregate: [`I'm B`] };
  };
  const nodeC2 = (state: typeof ConditionalBranchingAnnotation.State) => {
    console.log(`Adding I'm C to :${state.aggregate}`);
    RESULT.push(`Adding I'm C to :${state.aggregate}`);
    return { aggregate: [`I'm C`] };
  };
  const nodeD2 = (state: typeof ConditionalBranchingAnnotation.State) => {
    console.log(`Adding I'm D to :${state.aggregate}`);
    RESULT.push(`Adding I'm D to :${state.aggregate}`);
    return { aggregate: [`I'm D`] };
  };
  const nodeE2 = (state: typeof ConditionalBranchingAnnotation.State) => {
    console.log(`Adding I'm E to :${state.aggregate}`);
    RESULT.push(`Adding I'm E to :${state.aggregate}`);
    return { aggregate: [`I'm E`] };
  };

  function routeCDorBC(
    state: typeof ConditionalBranchingAnnotation.State
  ): string[] {
    if (state.which === "cd") {
      return ["c", "d"];
    }
    return ["b", "c"];
  }

  const builder = new StateGraph(ConditionalBranchingAnnotation)
    .addNode("a", nodeA2)
    .addEdge(START, "a")
    .addNode("b", nodeB2)
    .addNode("c", nodeC2)
    .addNode("d", nodeD2)
    .addNode("e", nodeE2)
    .addConditionalEdges("a", routeCDorBC, ["b", "c", "d"])
    .addEdge("b", "e")
    .addEdge("c", "e")
    .addEdge("d", "e")
    .addEdge("e", END);

  const graph = builder.compile();

  const buffer = (
    await (await graph.getGraphAsync()).drawMermaidPng({})
  ).arrayBuffer();
  fs.writeFile("./diagram-2.png", Buffer.from(await buffer));

  /* --------------------------------- Invoke --------------------------------- */

  let result = await graph.invoke({ aggregate: [], which: "bc" });
  console.log("Result 1: ", result);

  /* --------------------------------- output --------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT_2.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
