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

  const parentGraph = new StateGraph(RouterStateAnnotation)
    .addNode("routerNode", routerNode)
    .addNode("normalLLMNode", normalLLMNode)
    .addNode("weatherGraph", subgraph)
    .addEdge("__start__", "routerNode")
    .addConditionalEdges("routerNode", routeAfterPrediction)
    .addEdge("normalLLMNode", "__end__")
    .addEdge("weatherGraph", "__end__")
    .compile();

  // prettier-ignore
  buffer = (await (await parentGraph.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./diagram-parent-graph.png", Buffer.from(await buffer));

  /* -------------------------------------------------------------------------- */
  /*                           Grand  Parent Graph                              */
  /* -------------------------------------------------------------------------- */

  const checkpointer = new MemorySaver();

  const GrandfatherStateAnnotation = Annotation.Root({
    ...MessagesAnnotation.spec,
    toContinue: Annotation<boolean>,
  });

  const grandparentRouterNode = async (
    _state: typeof GrandfatherStateAnnotation.State
  ) => {
    return { toContinue: true };
  };

  const grandparentConditionalEdge = async (
    state: typeof GrandfatherStateAnnotation.State
  ) => {
    if (state.toContinue) {
      return "parentGraph";
    } else {
      return "__end__";
    }
  };

  const grandparentGraph = new StateGraph(GrandfatherStateAnnotation)
    .addNode("routerNode", grandparentRouterNode)
    .addNode("parentGraph", parentGraph)
    .addEdge("__start__", "routerNode")
    .addConditionalEdges("routerNode", grandparentConditionalEdge)
    .addEdge("parentGraph", "__end__")
    .compile({ checkpointer });

  // prettier-ignore
  buffer = (await (await grandparentGraph.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile(
    "./diagram-grand-parent-graph.png",
    Buffer.from(await buffer)
  );

  /* -------------------------------------------------------------------------- */
  /*                                   stream                                   */
  /* -------------------------------------------------------------------------- */

  const grandparentConfig = {
    configurable: { thread_id: "1" },
  };

  RESULT.push({
    messages: [
      {
        role: "user",
        content: "what's the weather in SF",
      },
    ],
  });

  const grandparentGraphStream = await grandparentGraph.stream(
    {
      messages: [
        {
          role: "user",
          content: "what's the weather in SF",
        },
      ],
    },
    {
      ...grandparentConfig,
      streamMode: "updates",
      subgraphs: true,
    }
  );

  for await (const update of grandparentGraphStream) {
    console.log(update);
    RESULT.push(update);
  }

  const grandparentGraphState = await grandparentGraph.getState(
    grandparentConfig,
    { subgraphs: true }
  );

  const parentGraphState = grandparentGraphState.tasks[0]
    .state as StateSnapshot;
  const subgraphState = parentGraphState.tasks[0].state as StateSnapshot;

  console.log("Grandparent State:");
  console.log(grandparentGraphState.values);
  RESULT.push({ "Grandparent State:": grandparentGraphState.values });
  console.log("---------------");
  console.log("Parent Graph State:");
  console.log(parentGraphState.values);
  RESULT.push({ "Parent Graph State:": parentGraphState.values });
  console.log("---------------");
  console.log("Subgraph State:");
  console.log(subgraphState.values);
  RESULT.push({ "Subgraph State:": subgraphState.values });

  await grandparentGraph.updateState(
    subgraphState.config,
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

  const updatedGrandparentGraphStream = await grandparentGraph.stream(null, {
    ...grandparentConfig,
    streamMode: "updates",
    subgraphs: true,
  });

  for await (const update of updatedGrandparentGraphStream) {
    console.log(update);
    RESULT.push(update);
  }

  console.log(
    (await grandparentGraph.getState(grandparentConfig)).values.messages
  );
  RESULT.push({
    "Grandparent State:": (await grandparentGraph.getState(grandparentConfig))
      .values.messages,
  });

  const grandparentStateHistories = await grandparentGraph.getStateHistory(
    grandparentConfig
  );
  for await (const state of grandparentStateHistories) {
    console.log(state);
    RESULT.push(state);
    console.log("-----");
  }

  /* -------------------------------------------------------------------------- */
  /*                                   Result                                   */
  /* -------------------------------------------------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT-double-nested.json", JSON.stringify(RESULT, null, 2), "utf8");
})();
