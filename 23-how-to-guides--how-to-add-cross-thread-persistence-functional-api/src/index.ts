import { BaseMessage, BaseMessageLike } from "@langchain/core/messages";
import {
  addMessages,
  BaseStore,
  entrypoint,
  InMemoryStore,
  MemorySaver,
  task,
} from "@langchain/langgraph";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import * as fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";

(async () => {
  const RESULT: (object | string)[] = [];

  /* ---------------------------------- Model --------------------------------- */

  const model = new ChatOpenAI({ model: "gpt-4o" });

  /* ---------------------------------- store --------------------------------- */
  const inMemoryStore = new InMemoryStore({
    index: {
      embeddings: new OpenAIEmbeddings({
        model: "text-embedding-3-small",
      }),
      dims: 1536,
    },
  });

  /* ---------------------------------- node ---------------------------------- */

  const callModel = task(
    "callModel",
    async (messages: BaseMessage[], memoryStore: BaseStore, userId: string) => {
      const namespace = ["memories", userId];
      const lastMessage = messages.at(-1);
      if (typeof lastMessage?.content !== "string") {
        throw new Error("Received non-string message content.");
      }
      const memories = await memoryStore.search(namespace, {
        query: lastMessage.content,
      });
      const info = memories.map((memory) => memory.value.data).join("\n");
      const systemMessage = `You are a helpful assistant talking to the user. User info: ${info}`;

      // Store new memories if the user asks the model to remember
      if (lastMessage.content.toLowerCase().includes("remember")) {
        // Hard-coded for demo
        const memory = `Username is Bob`;
        await memoryStore.put(namespace, uuidv4(), { data: memory });
      }
      const response = await model.invoke([
        {
          role: "system",
          content: systemMessage,
        },
        ...messages,
      ]);
      return response;
    }
  );

  /* -------------------------------- workflow -------------------------------- */

  const workflow = entrypoint(
    {
      checkpointer: new MemorySaver(),
      store: inMemoryStore,
      name: "workflow",
    },
    async (
      params: {
        messages: BaseMessageLike[];
        userId: string;
      },
      config
    ) => {
      const messages = addMessages([], params.messages);
      const response = await callModel(messages, config.store!, params.userId);
      return entrypoint.final({
        value: response,
        save: addMessages(messages, response),
      });
    }
  );
  /* ------------------------------ Frist Stream ------------------------------ */
  const config = {
    configurable: {
      thread_id: "1",
    },
    streamMode: "values" as const,
  };

  const inputMessage = {
    role: "user",
    content: "Hi! Remember: my name is Bob",
  };

  const stream = await workflow.stream(
    { messages: [inputMessage], userId: "1" },
    config
  );

  for await (const chunk of stream) {
    console.log(chunk);
    RESULT.push({ config, chunk });
  }

  /* ------------------------------ Second Stream ----------------------------- */
  const config2 = {
    configurable: {
      thread_id: "2",
    },
    streamMode: "values" as const,
  };

  const followupStream = await workflow.stream(
    {
      messages: [
        {
          role: "user",
          content: "what is my name?",
        },
      ],
      userId: "1",
    },
    config2
  );

  for await (const chunk of followupStream) {
    console.log(chunk);
    RESULT.push({ config, chunk });
  }

  /* ------------------------------ search memory ----------------------------- */

  const memories = await inMemoryStore.search(["memories", "1"]);
  for (const memory of memories) {
    console.log(memory.value);
    RESULT.push({ "memories 1": memory.value });
  }

  /* ------------------------------ Third Stream ------------------------------ */

  const config3 = {
    configurable: {
      thread_id: "3",
    },
    streamMode: "values" as const,
  };

  const otherUserStream = await workflow.stream(
    {
      messages: [
        {
          role: "user",
          content: "what is my name?",
        },
      ],
      userId: "2",
    },
    config3
  );

  for await (const chunk of otherUserStream) {
    console.log(chunk);
    RESULT.push({ config, chunk });
  }

  /* --------------------------------- Result --------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
