import {
  Annotation,
  MemorySaver,
  MessagesAnnotation,
  StateGraph,
  StateSnapshot,
} from "@langchain/langgraph";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import * as fs from "fs/promises";

(async () => {
  let RESULT: (object | string)[] = [];

  /* -------------------------------------------------------------------------- */
  /*                               Define subgraph                              */
  /* -------------------------------------------------------------------------- */

  const getWeather = tool(
    async ({ city }: { city: string }) => {
      return `It's sunny in ${city}`;
    },
    {
      name: "get_weather",
      description: "Get the weather for a specific city",
      schema: z.object({
        city: z.string().describe("A city name"),
      }),
    }
  );

  const rawModel = new ChatOpenAI({ model: "gpt-4o-mini" });
  const model = rawModel.withStructuredOutput(getWeather);

  const response = await model.invoke("San Francisco");
  RESULT.push(response);
  console.log(response);

  const SubGraphAnnotation = Annotation.Root({
    ...MessagesAnnotation.spec,
    city: Annotation<string>,
  });

  const modelNode = async (state: typeof SubGraphAnnotation.State) => {
    const result = await model.invoke(state.messages);
    return { city: result.city };
  };

  const weatherNode = async (state: typeof SubGraphAnnotation.State) => {
    const result = await getWeather.invoke({ city: state.city });
    return {
      messages: [
        {
          role: "assistant",
          content: result,
        },
      ],
    };
  };

  const subgraph = new StateGraph(SubGraphAnnotation)
    .addNode("modelNode", modelNode)
    .addNode("weatherNode", weatherNode)
    .addEdge("__start__", "modelNode")
    .addEdge("modelNode", "weatherNode")
    .addEdge("weatherNode", "__end__")
    .compile({ interruptBefore: ["weatherNode"] });

  // prettier-ignore
  let buffer = (await (await subgraph.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./diagram-subgraph.png", Buffer.from(await buffer));

  /* -------------------------------------------------------------------------- */
  /*                             Define parent graph                            */
  /* -------------------------------------------------------------------------- */

  const memory = new MemorySaver();
  const RouterStateAnnotation = Annotation.Root({
    ...MessagesAnnotation.spec,
    route: Annotation<"weather" | "other">,
  });

  const routerModel = rawModel.withStructuredOutput(
    z.object({
      route: z
        .enum(["weather", "other"])
        .describe(
          "A step that should execute next to based on the current input"
        ),
    }),
    {
      name: "router",
    }
  );

  const routerNode = async (state: typeof RouterStateAnnotation.State) => {
    const systemMessage = {
      role: "system",
      content: "Classify the incoming query as either about weather or not.",
    };
    const messages = [systemMessage, ...state.messages];
    const { route } = await routerModel.invoke(messages);
    return { route };
  };

  const normalLLMNode = async (state: typeof RouterStateAnnotation.State) => {
    const responseMessage = await rawModel.invoke(state.messages);
    return { messages: [responseMessage] };
  };

  const routeAfterPrediction = async (
    state: typeof RouterStateAnnotation.State
  ) => {
    if (state.route === "weather") {
      return "weatherGraph";
    } else {
      return "normalLLMNode";
    }
  };

  const graph = new StateGraph(RouterStateAnnotation)
    .addNode("routerNode", routerNode)
    .addNode("normalLLMNode", normalLLMNode)
    .addNode("weatherGraph", subgraph)
    .addEdge("__start__", "routerNode")
    .addConditionalEdges("routerNode", routeAfterPrediction)
    .addEdge("normalLLMNode", "__end__")
    .addEdge("weatherGraph", "__end__")
    .compile({ checkpointer: memory });

  // prettier-ignore
  buffer = (await (await graph.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./diagram-parent-graph.png", Buffer.from(await buffer));

  /* -------------------------------------------------------------------------- */
  /*                                   stream                                   */
  /* -------------------------------------------------------------------------- */

  /* -------------------------------- thread 1 -------------------------------- */

  RESULT.push([
    { configurable: { thread_id: "1" } },
    { messages: [{ role: "user", content: "hi!" }] },
  ]);

  const config = { configurable: { thread_id: "1" } };

  const inputs = { messages: [{ role: "user", content: "hi!" }] };

  const stream = await graph.stream(inputs, {
    ...config,
    streamMode: "updates",
  });

  for await (const update of stream) {
    console.log(update);
    RESULT.push(update);
  }

  /* -------------------------------- thread 2 -------------------------------- */

  RESULT.push([
    { configurable: { thread_id: "2" } },
    { messages: [{ role: "user", content: "what's the weather in sf" }] },
  ]);

  const config2 = { configurable: { thread_id: "2" } };

  const streamWithBreakpoint = await graph.stream(
    {
      messages: [
        {
          role: "user",
          content: "what's the weather in sf",
        },
      ],
    },
    { ...config2, streamMode: "updates" }
  );

  for await (const update of streamWithBreakpoint) {
    console.log(update);
    RESULT.push(update);
  }

  /* -------------------------------- thread 3 -------------------------------- */

  RESULT.push([
    {
      configurable: { thread_id: "3" },
      streamMode: "updates",
      subgraphs: true,
    },
    { messages: [{ role: "user", content: "what's the weather in sf" }] },
  ]);

  const streamWithSubgraphs = await graph.stream(
    {
      messages: [
        {
          role: "user",
          content: "what's the weather in sf",
        },
      ],
    },
    { configurable: { thread_id: "3" }, streamMode: "updates", subgraphs: true }
  );

  for await (const update of streamWithSubgraphs) {
    console.log(update);
    RESULT.push(update);
  }

  const state = await graph.getState({ configurable: { thread_id: "3" } });

  console.log(JSON.stringify(state, null, 2));

  const resumedStream = await graph.stream(null, {
    configurable: { thread_id: "3" },
    streamMode: "values",
    subgraphs: true,
  });

  for await (const update of resumedStream) {
    console.log(update);
    RESULT.push(update);
  }

  /* --------------------- thread 4 update subgraph state --------------------- */

  RESULT.push([
    {
      configurable: { thread_id: "4" },
      streamMode: "updates",
      subgraphs: true,
    },
    {
      messages: [
        {
          role: "user",
          content: "what's the weather in sf",
        },
      ],
    },
  ]);

  const graphStream = await graph.stream(
    {
      messages: [
        {
          role: "user",
          content: "what's the weather in sf",
        },
      ],
    },
    {
      configurable: { thread_id: "4" },
      streamMode: "updates",
      subgraphs: true,
    }
  );

  for await (const update of graphStream) {
    console.log(update);
    RESULT.push(update);
  }

  const outerGraphState = await graph.getState(
    {
      configurable: {
        thread_id: "4",
      },
    },
    { subgraphs: true }
  );

  console.log(outerGraphState.tasks[0].state);
  RESULT.push([outerGraphState.tasks[0].state]);

  await graph.updateState(
    (outerGraphState.tasks[0].state as StateSnapshot).config,
    { city: "la" }
  );

  const resumedStreamWithUpdatedState = await graph.stream(null, {
    configurable: { thread_id: "4" },
    streamMode: "updates",
    subgraphs: true,
  });

  for await (const update of resumedStreamWithUpdatedState) {
    console.log(update);
    RESULT.push(update);
  }

  /* ------------------- thread 5: Acting as a subgraph node ------------------ */

  RESULT.push([
    {
      configurable: { thread_id: "5" },
    },
    { messages: [{ role: "user", content: "What's the weather in sf" }] },
  ]);

  const streamWithAsNode = await graph.stream(
    {
      messages: [
        {
          role: "user",
          content: "What's the weather in sf",
        },
      ],
    },
    {
      configurable: {
        thread_id: "5",
      },
    }
  );

  for await (const update of streamWithAsNode) {
    console.log(update);
    RESULT.push(update);
  }

  // Graph execution should stop before the weather node
  console.log("interrupted!");

  const interruptedState = await graph.getState(
    {
      configurable: {
        thread_id: "5",
      },
    },
    { subgraphs: true }
  );

  console.log(interruptedState);

  await graph.updateState(
    (interruptedState.tasks[0].state as StateSnapshot).config,
    {
      messages: [
        {
          role: "assistant",
          content: "rainy",
        },
      ],
    },
    "weatherNode"
  );

  const resumedStreamWithAsNode = await graph.stream(null, {
    configurable: {
      thread_id: "5",
    },
    streamMode: "updates",
    subgraphs: true,
  });

  for await (const update of resumedStreamWithAsNode) {
    console.log(update);
    RESULT.push(update);
  }

  console.log(
    await graph.getState(
      {
        configurable: {
          thread_id: "5",
        },
      },
      { subgraphs: true }
    )
  );

  /* ----------------- thread 6: Acting as the entire subgraph ---------------- */

  RESULT.push([
    {
      configurable: { thread_id: "6" },
    },
    { messages: [{ role: "user", content: "what's the weather in sf" }] },
  ]);

  const entireSubgraphExampleStream = await graph.stream(
    {
      messages: [
        {
          role: "user",
          content: "what's the weather in sf",
        },
      ],
    },
    {
      configurable: {
        thread_id: "6",
      },
      streamMode: "updates",
      subgraphs: true,
    }
  );

  for await (const update of entireSubgraphExampleStream) {
    console.log(update);
    RESULT.push(update);
  }
  console.log("interrupted!");

  await graph.updateState(
    {
      configurable: {
        thread_id: "6",
      },
    },
    {
      messages: [{ role: "assistant", content: "rainy" }],
    },
    "weatherGraph"
  );

  const resumedEntireSubgraphExampleStream = await graph.stream(null, {
    configurable: {
      thread_id: "6",
    },
    streamMode: "updates",
  });

  for await (const update of resumedEntireSubgraphExampleStream) {
    console.log(update);
    RESULT.push(update);
  }

  const currentStateAfterUpdate = await graph.getState({
    configurable: {
      thread_id: "6",
    },
  });

  console.log(currentStateAfterUpdate.values.messages);
  RESULT.push([currentStateAfterUpdate.values.messages]);

  /* -------------------------------------------------------------------------- */
  /*                                   Result                                   */
  /* -------------------------------------------------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT-basic.json", JSON.stringify(RESULT, null, 2), "utf8");
})();
