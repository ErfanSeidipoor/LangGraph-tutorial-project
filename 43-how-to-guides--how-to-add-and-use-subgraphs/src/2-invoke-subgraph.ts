import { Annotation, StateGraph } from "@langchain/langgraph";
import * as fs from "fs/promises";

(async () => {
  let RESULT: (object | string)[] = [];

  /* -------------------------------- subgraph1 ------------------------------- */

  const SubgraphAnnotation = Annotation.Root({
    bar: Annotation<string>,
    baz: Annotation<string>,
  });

  const subgraphNodeOne = async (state: typeof SubgraphAnnotation.State) => {
    return { baz: "baz" };
  };

  const subgraphNodeTwo = async (state: typeof SubgraphAnnotation.State) => {
    return { bar: state.bar + state.baz };
  };

  const subgraphCalledInFunction = new StateGraph(SubgraphAnnotation)
    .addNode("subgraphNode1", subgraphNodeOne)
    .addNode("subgraphNode2", subgraphNodeTwo)
    .addEdge("__start__", "subgraphNode1")
    .addEdge("subgraphNode1", "subgraphNode2")
    .compile();

  const ParentAnnotation = Annotation.Root({
    foo: Annotation<string>,
  });

  const nodeOne = async (state: typeof ParentAnnotation.State) => {
    return {
      foo: "hi! " + state.foo,
    };
  };

  const nodeTwo = async (state: typeof ParentAnnotation.State) => {
    const response = await subgraphCalledInFunction.invoke({
      bar: state.foo,
    });
    return { foo: response.bar };
  };

  const graphWithFunction = new StateGraph(ParentAnnotation)
    .addNode("node1", nodeOne)
    .addNode("node2", nodeTwo)
    .addEdge("__start__", "node1")
    .addEdge("node1", "node2")
    .compile();

  const graphWithFunctionStream = await graphWithFunction.stream(
    { foo: "foo" },
    { subgraphs: true }
  );
  for await (const chunk of graphWithFunctionStream) {
    console.log(chunk);
    RESULT.push(chunk);
  }

  /* --------------------------------- Result --------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT-invoke-subgraph.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
