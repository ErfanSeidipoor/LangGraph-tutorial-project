import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  RemoveMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import {
  Annotation,
  END,
  MemorySaver,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import * as fs from "fs/promises";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";

(async () => {
  const RESULT: (object | string)[] = [];

  /* ---------------------------------- State --------------------------------- */

  const GraphAnnotation = Annotation.Root({
    ...MessagesAnnotation.spec,
    summary: Annotation<string>({
      reducer: (_, action) => action,
      default: () => "",
    }),
  });

  /* ---------------------------------- Model --------------------------------- */
  const model = new ChatOpenAI({ model: "gpt-4o" });

  /* --------------------------------- memory --------------------------------- */

  const memory = new MemorySaver();

  // /* ---------------------------------- node ---------------------------------- */

  async function callModel(
    state: typeof GraphAnnotation.State
  ): Promise<Partial<typeof GraphAnnotation.State>> {
    const { summary } = state;
    let { messages } = state;

    if (summary) {
      const systemMessage = new SystemMessage({
        id: uuidv4(),
        content: `Summary of conversation earlier: ${summary}`,
      });
      messages = [systemMessage, ...messages];
    }

    const response = await model.invoke(messages);
    return { messages: [response] };
  }

  async function summarizeConversationNode(
    state: typeof GraphAnnotation.State
  ): Promise<Partial<typeof GraphAnnotation.State>> {
    const { summary, messages } = state;
    let summaryMessage: string;
    if (summary) {
      summaryMessage =
        `This is summary of the conversation to date: ${summary}\n\n` +
        "Extend the summary by taking into account the new messages above:";
    } else {
      summaryMessage = "Create a summary of the conversation above:";
    }

    const allMessages = [
      ...messages,
      new HumanMessage({
        id: uuidv4(),
        content: summaryMessage,
      }),
    ];
    const response = await model.invoke(allMessages);
    const deleteMessages = messages
      .slice(0, -2)
      .map((m) => new RemoveMessage({ id: m.id! }));
    if (typeof response.content !== "string") {
      throw new Error("Expected a string response from the model");
    }
    return { summary: response.content, messages: deleteMessages };
  }

  /* ---------------------------------- edge ---------------------------------- */

  function shouldContinue(
    state: typeof GraphAnnotation.State
  ): "summarizeConversationNode" | typeof END {
    const messages = state.messages;
    if (messages.length >= 6) {
      return "summarizeConversationNode";
    }
    return END;
  }

  /* -------------------------------- Workflow -------------------------------- */
  const workflow = new StateGraph(GraphAnnotation)
    .addNode("callModel", callModel)
    .addNode("summarizeConversationNode", summarizeConversationNode)
    .addEdge(START, "callModel")
    .addConditionalEdges("callModel", shouldContinue)
    .addEdge("summarizeConversationNode", END);

  const app = workflow.compile({ checkpointer: memory });

  // prettier-ignore
  const buffer = (await (await app.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./diagram.png", Buffer.from(await buffer));

  /* ---------------------------------- Print --------------------------------- */
  const printUpdate = (update: Record<string, any>) => {
    Object.keys(update).forEach((key) => {
      const value = update[key];

      if ("messages" in value && Array.isArray(value.messages)) {
        value.messages.forEach((msg: BaseMessage) => {
          console.log(
            `\n================================ ${msg.getType()} Message =================================`
          );
          console.log(msg.content);
        });
      }
      if ("summary" in value && value.summary) {
        console.log(value.summary);
      }
    });
  };

  /* --------------------------------- stream --------------------------------- */

  const config = {
    configurable: { thread_id: "4" },
    streamMode: "updates" as const,
  };

  const inputMessage = new HumanMessage({
    id: uuidv4(),
    content: "hi! I'm bob",
  });

  for await (const event of await app.stream(
    { messages: [inputMessage] },
    config
  )) {
    printUpdate(event);
  }

  RESULT.push((await app.getState(config)).values);

  const inputMessage2 = new HumanMessage({
    id: uuidv4(),
    content: "What did I sat my name was?",
  });
  console.log(inputMessage2.content);
  for await (const event of await app.stream(
    { messages: [inputMessage2] },
    config
  )) {
    printUpdate(event);
  }

  RESULT.push((await app.getState(config)).values);

  const inputMessage3 = new HumanMessage({
    id: uuidv4(),
    content: "i like the celtics!",
  });
  console.log(inputMessage3.content);
  for await (const event of await app.stream(
    { messages: [inputMessage3] },
    config
  )) {
    printUpdate(event);
  }

  RESULT.push((await app.getState(config)).values);

  /* --------------------------------- result --------------------------------- */
  const values = (await app.getState(config)).values;
  console.log(values);

  /* --------------------------------- Result --------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
