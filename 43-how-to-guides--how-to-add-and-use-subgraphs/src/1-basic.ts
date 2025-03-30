import { Annotation, StateGraph } from "@langchain/langgraph";
import * as fs from "fs/promises";

(async () => {
  let RESULT: (object | string)[] = [];

  /* -------------------------------- subgraph1 ------------------------------- */

  const SubgraphStateAnnotation = Annotation.Root({
    foo: Annotation<string>,
    bar: Annotation<string>,
  });

  const subgraphNode1 = async (state: typeof SubgraphStateAnnotation.State) => {
    return { bar: "bar" };
  };

  const subgraphNode2 = async (state: typeof SubgraphStateAnnotation.State) => {
    return { foo: state.foo + state.bar };
  };

  const subgraphBuilder = new StateGraph(SubgraphStateAnnotation)
    .addNode("subgraphNode1", subgraphNode1)
    .addNode("subgraphNode2", subgraphNode2)
    .addEdge("__start__", "subgraphNode1")
    .addEdge("subgraphNode1", "subgraphNode2");

  const subgraph = subgraphBuilder.compile();

  // prettier-ignore
  let buffer = (await (await subgraph.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile(
    "./diagram-basic-subgraph1.png",
    Buffer.from(await buffer)
  );

  /* --------------------------------- Parent --------------------------------- */

  const ParentStateAnnotation = Annotation.Root({
    foo: Annotation<string>,
  });

  const node1 = async (state: typeof ParentStateAnnotation.State) => {
    return {
      foo: "hi! " + state.foo,
    };
  };

  const builder = new StateGraph(ParentStateAnnotation)
    .addNode("node1", node1)
    .addNode("node2", subgraph)
    .addEdge("__start__", "node1")
    .addEdge("node1", "node2");

  const graph = builder.compile();

  // prettier-ignore
  buffer = (await (await graph.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./diagram-basic-parent.png", Buffer.from(await buffer));

  const stream = await graph.stream({ foo: "foo" });

  for await (const chunk of stream) {
    console.log(chunk);
  }

  const streamWithSubgraphs = await graph.stream(
    { foo: "foo" },
    { subgraphs: true }
  );

  for await (const chunk of streamWithSubgraphs) {
    console.log(chunk);
    RESULT.push(chunk);
  }

  /* --------------------------------- Result --------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT-basic.json", JSON.stringify(RESULT, null, 2), "utf8");
})();
