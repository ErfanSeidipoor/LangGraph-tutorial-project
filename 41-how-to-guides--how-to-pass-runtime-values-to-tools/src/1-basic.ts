import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  isAIMessage,
  isHumanMessage,
  isToolMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import {
  END,
  getCurrentTaskInput,
  InMemoryStore,
  LangGraphRunnableConfig,
  MemorySaver,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import * as fs from "fs/promises";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

(async () => {
  let RESULT: (object | string)[] = [];

  /* --------------------------------- update --------------------------------- */

  const updateFavoritePets = tool(
    async (input, config: LangGraphRunnableConfig) => {
      const { pets } = input;
      const currentState =
        getCurrentTaskInput() as typeof MessagesAnnotation.State;
      const userId = config.configurable?.userId;
      const store = config.store;

      await store?.put([userId, "pets"], "names", pets);
      await store?.put([userId, "pets"], "context", {
        content: currentState.messages[0].content,
      });

      return "update_favorite_pets called.";
    },
    {
      name: "update_favorite_pets",
      description: "add to the list of favorite pets.",
      schema: z.object({ pets: z.array(z.string()) }),
    }
  );

  console.dir(zodToJsonSchema(updateFavoritePets.schema), { depth: null });
  RESULT.push(zodToJsonSchema(updateFavoritePets.schema));

  /* -------------------------------- retrieve -------------------------------- */
  const getFavoritePets = tool(
    async (input, config: LangGraphRunnableConfig) => {
      const userId = config.configurable?.userId;

      const store = config.store;
      const petNames = await store?.get([userId, "pets"], "names");
      const context = await store?.get([userId, "pets"], "context");
      return JSON.stringify({
        pets: petNames?.value,
        context: context?.value.content,
      });
    },
    {
      name: "get_favorite_pets",
      description: "retrieve the list of favorite pets for the given user.",
      schema: z.object({}),
    }
  );

  /* ---------------------------------- nodes --------------------------------- */

  const model = new ChatOpenAI({ model: "gpt-4o-mini" });
  const tools = [getFavoritePets, updateFavoritePets];

  const routeMessage = (state: typeof MessagesAnnotation.State) => {
    const { messages } = state;
    const lastMessage = messages[messages.length - 1] as AIMessage;
    if (!lastMessage?.tool_calls?.length) {
      return END;
    }
    return "tools";
  };

  const callModel = async (state: typeof MessagesAnnotation.State) => {
    const { messages } = state;
    const modelWithTools = model.bindTools(tools);
    const responseMessage = await modelWithTools.invoke([
      {
        role: "system",
        content:
          "You are a personal assistant. Store any preferences the user tells you about.",
      },
      ...messages,
    ]);
    return { messages: [responseMessage] };
  };

  /* -------------------------------- workflow -------------------------------- */

  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("agent", callModel)
    .addNode("tools", new ToolNode(tools))
    .addEdge(START, "agent")
    .addConditionalEdges("agent", routeMessage)
    .addEdge("tools", "agent");

  const memory = new MemorySaver();
  const store = new InMemoryStore();

  const graph = workflow.compile({ checkpointer: memory, store: store });

  // prettier-ignore
  const buffer = (await (await graph.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./diagram-basic.png", Buffer.from(await buffer));

  /* --------------------------------- invoke --------------------------------- */
  let inputs = {
    messages: [
      new HumanMessage({
        content: "My favorite pet is a terrier. I saw a cute one on Twitter.",
      }),
    ],
  };

  let config = {
    configurable: {
      thread_id: "1",
      userId: "a-user",
    },
  };

  function printMessages(messages: BaseMessage[]) {
    for (const message of messages) {
      if (isHumanMessage(message)) {
        console.log(`User: ${message.content}`);
        RESULT.push(`User: ${message.content}`);
      } else if (isAIMessage(message)) {
        const aiMessage = message as AIMessage;
        if (aiMessage.content) {
          console.log(`Assistant: ${aiMessage.content}`);
          RESULT.push(`Assistant: ${aiMessage.content}`);
          if (aiMessage.tool_calls) {
            for (const toolCall of aiMessage.tool_calls) {
              console.log(
                `Tool call: ${toolCall.name}(${JSON.stringify(toolCall.args)})`
              );
              RESULT.push(
                `Tool call: ${toolCall.name}(${JSON.stringify(toolCall.args)})`
              );
            }
          }
        } else if (isToolMessage(message)) {
          const toolMessage = message as ToolMessage;
          console.log(
            `${toolMessage.name} tool output: ${toolMessage.content}`
          );
          RESULT.push(
            `${toolMessage.name} tool output: ${toolMessage.content}`
          );
        }
      }
    }
  }

  let messages = (await graph.invoke(inputs, config)).messages;

  printMessages(messages);

  inputs = {
    messages: [
      new HumanMessage({
        content:
          "What're my favorite pets and what did I say when I told you about them?",
      }),
    ],
  };
  config = {
    configurable: {
      thread_id: "2",
      userId: "a-user",
    },
  };

  messages = (await graph.invoke(inputs, config)).messages;

  printMessages(messages);

  /* --------------------------------- Result --------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT-basic.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
