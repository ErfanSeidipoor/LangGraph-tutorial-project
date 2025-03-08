import {
  Annotation,
  LangGraphRunnableConfig,
  MemorySaver,
  StateGraph,
} from "@langchain/langgraph";
import * as fs from "fs/promises";

(async () => {
  const RESULT: (object | string)[] = [];

  /* --------------------------------- memory --------------------------------- */
  const checkpointer = new MemorySaver();
  /* -------------------------------- subgraph -------------------------------- */

  const SubgraphStateAnnotation = Annotation.Root({
    foo: Annotation<string>,
    bar: Annotation<string>,
  });

  const subgraphNode1 = async (state: typeof SubgraphStateAnnotation.State) => {
    RESULT.push({ subgraphNode1: { bar: "bar" } });
    return { bar: "bar" };
  };

  const subgraphNode2 = async (state: typeof SubgraphStateAnnotation.State) => {
    RESULT.push({ subgraphNode2: { foo: state.foo + state.bar } });
    return { foo: state.foo + state.bar };
  };

  const subgraph = new StateGraph(SubgraphStateAnnotation)
    .addNode("subgraphNode1", subgraphNode1)
    .addNode("subgraphNode2", subgraphNode2)
    .addEdge("__start__", "subgraphNode1")
    .addEdge("subgraphNode1", "subgraphNode2")
    .compile({
      checkpointer: checkpointer,
    });

  // prettier-ignore

  let buffer = (await (await subgraph.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./sub-graph.png", Buffer.from(await buffer));

  /* ------------------------------ parent graph ------------------------------ */
  const StateAnnotation = Annotation.Root({
    foo: Annotation<string>,
  });

  const node1 = async (state: typeof StateAnnotation.State) => {
    RESULT.push({
      node1: {
        foo: "hi! " + state.foo,
      },
    });

    return {
      foo: "hi! " + state.foo,
    };
  };

  const builder = new StateGraph(StateAnnotation)
    .addNode("node1", node1)
    .addNode("node2", subgraph)
    .addEdge("__start__", "node1")
    .addEdge("node1", "node2");

  const graph = builder.compile({
    checkpointer: checkpointer,
  });

  // prettier-ignore
  buffer = (await (await graph.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./parent-graph.png", Buffer.from(await buffer));

  /* ------------------------ Verify persistence works ------------------------ */
  const config = { configurable: { thread_id: "1" } };
  const stream = await graph.stream(
    {
      foo: "foo",
    },
    {
      ...config,
      subgraphs: true,
    }
  );

  for await (const [_source, chunk] of stream) {
    console.log(chunk);
  }

  /* -------------------------------- getState -------------------------------- */

  const currentState = (await graph.getState(config)).values;
  let stateWithSubgraph;

  const graphHistories = await graph.getStateHistory(config);
  for await (const state of graphHistories) {
    if (state.next[0] === "node2") {
      stateWithSubgraph = state;
      break;
    }
  }
  const subgraphConfig = stateWithSubgraph!.tasks[0].state;

  const subGraphState = (
    await graph.getState(
      subgraphConfig as LangGraphRunnableConfig<Record<string, any>>
    )
  ).values;

  RESULT.push({
    currentState,
    stateWithSubgraph,
    subgraphConfig,
    subGraphState,
  });

  console.log({ subGraphState });

  // /* --------------------------------- Result --------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
