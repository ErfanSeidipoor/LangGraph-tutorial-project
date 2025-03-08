import {
  Annotation,
  LangGraphRunnableConfig,
  MemorySaver,
  messagesStateReducer,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { v4 as uuidv4 } from "uuid";
import { ChatOpenAI } from "@langchain/openai";

import { BaseMessage, HumanMessage } from "@langchain/core/messages";
import { InMemoryStore } from "@langchain/langgraph";

import * as fs from "fs/promises";

(async () => {
  const RESULT: (object | string)[] = [];

  /* ---------------------------------- State --------------------------------- */

  const StateAnnotation = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
      reducer: messagesStateReducer,
      default: () => [],
    }),
  });

  /* ---------------------------------- model --------------------------------- */

  const model = new ChatOpenAI({ model: "gpt-4o" });

  /* ---------------------------------- nodes --------------------------------- */

  const callModel = async (
    state: typeof StateAnnotation.State,
    config: LangGraphRunnableConfig
  ): Promise<Partial<typeof StateAnnotation.State>> => {
    const store = config.store;
    if (!store) {
      if (!store) {
        throw new Error("store is required when compiling the graph");
      }
    }

    if (!config.configurable?.userId) {
      throw new Error("userId is required in the config");
    }

    const namespace = ["memories", config.configurable?.userId];
    const memories = await store.search(namespace);
    const info = memories.map((d) => d.value.data).join("\n");

    const systemMsg = `You are a helpful assistant talking to the user. User info: ${info}`;

    const lastMessage = state.messages[state.messages.length - 1];

    if (
      typeof lastMessage.content === "string" &&
      lastMessage.content.toLowerCase().includes("remember")
    ) {
      RESULT.push("store", [
        namespace,
        uuidv4(),
        { data: lastMessage.content },
      ]);
      await store.put(namespace, uuidv4(), { data: lastMessage.content });
    }

    const response = await model.invoke([
      { type: "system", content: systemMsg },
      ...state.messages,
    ]);
    return { messages: [response] };
  };

  /* ---------------------------------- Graph --------------------------------- */
  const inMemoryStore = new InMemoryStore();

  const builder = new StateGraph(StateAnnotation)
    .addNode("callModel", callModel)
    .addEdge(START, "callModel");

  const graph = builder.compile({
    checkpointer: new MemorySaver(),
    store: inMemoryStore,
  });
  /* ------------------------------ Run the graph ----------------------------- */

  let config = { configurable: { thread_id: "1", userId: "1" } };
  let inputMessage = new HumanMessage("Hi! Remember: my name is Bob");

  for await (const chunk of await graph.stream(
    { messages: [inputMessage] },
    { ...config, streamMode: "values" }
  )) {
    console.log(chunk.messages[chunk.messages.length - 1]);
    RESULT.push(chunk.messages[chunk.messages.length - 1]);
  }

  /* ------------------------------ retrieve data ----------------------------- */
  const memories = await inMemoryStore.search(["memories", "1"]);

  for (const memory of memories) {
    const value = await memory.value;
    console.log(value);
    RESULT.push({ "retrieve data from userId=1": value });
  }

  config = { configurable: { thread_id: "2", userId: "1" } };
  inputMessage = new HumanMessage("what is my name?");

  for await (const chunk of await graph.stream(
    { messages: [inputMessage] },
    { ...config, streamMode: "values" }
  )) {
    console.log(chunk.messages[chunk.messages.length - 1]);
    RESULT.push(chunk.messages[chunk.messages.length - 1]);
  }

  /* ------------------------------ another user ------------------------------ */
  config = { configurable: { thread_id: "3", userId: "2" } };
  inputMessage = new HumanMessage("what is my name?");

  for await (const chunk of await graph.stream(
    { messages: [inputMessage] },
    { ...config, streamMode: "values" }
  )) {
    console.log(chunk.messages[chunk.messages.length - 1]);
    RESULT.push(chunk.messages[chunk.messages.length - 1]);
  }

  // /* --------------------------------- Result --------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
