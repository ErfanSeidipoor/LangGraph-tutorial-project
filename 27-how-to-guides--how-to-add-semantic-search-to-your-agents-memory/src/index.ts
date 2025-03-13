import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  isAIMessage,
  isHumanMessage,
  isSystemMessage,
  isToolMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { InMemoryStore, MessagesAnnotation } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import * as fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

(async () => {
  const RESULT: (object | string)[] = [];

  /* ------------------------------- embeddings ------------------------------- */

  const embeddings = new OpenAIEmbeddings({
    model: "text-embedding-3-small",
  });

  const store = new InMemoryStore({
    index: {
      embeddings,
      dims: 1536,
    },
  });

  /* ---------------------------------- tool ---------------------------------- */

  const upsertMemoryTool = tool(
    async ({ content }): Promise<string> => {
      await store.put(["user123", "memories"], uuidv4(), { text: content });
      return "Stored memory.";
    },
    {
      name: "upsert_memory",
      schema: z.object({
        content: z.string().describe("The content of the Memory to store."),
      }),
      description: "Upsert long-term memories.",
    }
  );

  /* ---------------------------------- Node ---------------------------------- */

  const addMemories = async (state: typeof MessagesAnnotation.State) => {
    const items = await store.search(["user123", "memories"], {
      query: state.messages[state.messages.length - 1].content as string,
      limit: 4,
    });

    const memories = items.length
      ? `
    ## Memories of user \n${items
      .map((item) => `${item.value.text} (similarity: ${item.score})`)
      .join("\n")}`
      : "";

    return [
      { role: "system", content: `You are a helpful assistant.\n${memories}` },
      ...state.messages,
    ];
  };

  /* ---------------------------------- agent --------------------------------- */

  const agent = createReactAgent({
    llm: new ChatOpenAI({ model: "gpt-4o-mini" }),
    tools: [upsertMemoryTool],
    prompt: addMemories,
    store: store,
  });

  /* ------------------------------ printMessages ----------------------------- */
  function printMessages(messages: BaseMessage[]) {
    for (const message of messages) {
      if (isSystemMessage(message)) {
        const systemMessage = message as SystemMessage;
        console.log(`System: ${systemMessage.content}`);
      } else if (isHumanMessage(message)) {
        const humanMessage = message as HumanMessage;
        console.log(`User: ${humanMessage.content}`);
      } else if (isAIMessage(message)) {
        const aiMessage = message as AIMessage;
        if (aiMessage.content) {
          console.log(`Assistant: ${aiMessage.content}`);
        }
        if (aiMessage.tool_calls) {
          for (const toolCall of aiMessage.tool_calls) {
            console.log(`\t${toolCall.name}(${JSON.stringify(toolCall.args)})`);
          }
        }
      } else if (isToolMessage(message)) {
        const toolMessage = message as ToolMessage;
        console.log(
          `\t\t${toolMessage.name} -> ${JSON.stringify(toolMessage.content)}`
        );
      }
    }
  }

  /* --------------------------------- Invoke --------------------------------- */
  let result = await agent.invoke({
    messages: [
      {
        role: "user",
        content: "I'm hungry. What should I eat?",
      },
    ],
  });

  printMessages(result.messages);

  result = await agent.invoke({
    messages: [
      {
        role: "user",
        content: "Please remember that every Thursday is trash day.",
      },
    ],
  });

  printMessages(result.messages);

  result = await agent.invoke({
    messages: [
      {
        role: "user",
        content: "When am I supposed to take out the garbage?",
      },
    ],
  });

  printMessages(result.messages);

  /* --------------------------------- Result --------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
