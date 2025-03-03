import { ChatPromptTemplate } from "@langchain/core/prompts";

import {
  END,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";

import {
  AIMessage,
  AIMessageChunk,
  BaseMessage,
  BaseMessageLike,
  HumanMessage,
} from "@langchain/core/messages";
import { Runnable } from "@langchain/core/runnables";
import * as fs from "fs/promises";

(async () => {
  const RESULT: (object | string)[] = [];

  const llm = new ChatOpenAI({
    model: "gpt-4o-mini",
  });

  /* ----------------------------- Define Chat Bot ---------------------------- */

  async function myChatBot(
    messages: BaseMessageLike[]
  ): Promise<AIMessageChunk> {
    const systemMessage = {
      role: "system",
      content: "You are a customer suppor agent for a airline",
    };

    const allMessages = [systemMessage, ...messages];

    const response = await llm.invoke(allMessages);

    return response;
  }

  const response = await myChatBot([{ role: "user", content: "hi!" }]);

  // Test the chat bot
  RESULT.push({ response });

  /* -------------------------- Define Simulated User ------------------------- */

  async function createSimulatedUser(): Promise<
    Runnable<{ messages: BaseMessageLike[] }, AIMessageChunk>
  > {
    const systemPromptTemplate = `You are a customer of an airline company. You are interacting with a user who is a customer support person 

    {instructions}

    If you have nothing more to add to the conversation, you must respond only with a single word: "FINISHED"`;

    const prompt = ChatPromptTemplate.fromMessages([
      ["system", systemPromptTemplate],
      ["placeholder", "{messages}"],
    ]);

    const instructions =
      "Your name is Harrison. You are trying to get a refund for the trip you took to Alaska. You want them to give you ALL the money back. Be extremely persistent. This trip happened 5 years ago.";

    const partialPrompt = await prompt.partial({ instructions });

    const simulatedUser = partialPrompt.pipe(llm);
    return simulatedUser;
  }

  // Test the simulated user
  const messages = [{ role: "user", content: "Hi! How can I help you?" }];
  const simulatedUser = await createSimulatedUser();
  const simulatedUserResponse = await simulatedUser.invoke({ messages });
  RESULT.push({ simulatedUserResponse });

  /* ----------------------- Define the Agent Simulation ---------------------- */

  async function chatBotNode(state: typeof MessagesAnnotation.State) {
    const messages = state.messages;
    const chatBotResponse = await myChatBot(messages);
    return { messages: [chatBotResponse] };
  }

  function swapRoles(messages: BaseMessage[]) {
    return messages.map((message) =>
      message instanceof AIMessage
        ? new HumanMessage({ content: message.content })
        : new AIMessage({ content: message.content })
    );
  }

  async function simulatedUserNode(state: typeof MessagesAnnotation.State) {
    const messages = state.messages;
    const newMessages = swapRoles(messages);

    const simulatedUser = await createSimulatedUser();
    const response = await simulatedUser.invoke({ messages: newMessages });

    return { messages: [{ role: "user", content: response.content }] };
  }

  function shouldContinue(state: typeof MessagesAnnotation.State) {
    const messages = state.messages;
    if (messages.length > 6) {
      return "__end__";
    } else if (messages[messages.length - 1].content === "FINISHED") {
      return "__end__";
    } else {
      return "continue";
    }
  }

  /* ---------------------------------- Graph --------------------------------- */
  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("simulatedUserNode", simulatedUserNode)
    .addNode("chatBotNode", chatBotNode)
    .addEdge("chatBotNode", "simulatedUserNode")
    .addConditionalEdges("simulatedUserNode", shouldContinue, {
      [END]: END,
      continue: "chatBotNode",
    })
    .addEdge(START, "chatBotNode");

  const app = workflow.compile();

  const buffer = (
    await (await app.getGraphAsync()).drawMermaidPng({})
  ).arrayBuffer();
  fs.writeFile("./diagram-1.png", Buffer.from(await buffer));

  /* ----------------------------------- run ---------------------------------- */
  for await (const chunk of await app.stream({})) {
    const nodeName = Object.keys(chunk)[0];
    const messages = chunk[nodeName].messages;
    console.log(`${nodeName}: ${messages[0].content}`);
    RESULT.push({ nodeName, response: messages[0].content });
    console.log("\n---\n");
  }

  /* --------------------------------- output --------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
