import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  RemoveMessage,
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

  const AgentState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
      reducer: (x, y) => x.concat(y),
    }),
  });

  /* --------------------------------- memory --------------------------------- */

  const memory = new MemorySaver();

  /* ---------------------------------- tools --------------------------------- */

  const searchTool = tool(
    () => {
      return "It's sunny in San Francisco, but you better look out if you're a Gemini 😈.";
    },
    {
      name: "search",
      description: "Call to surf the web",
      schema: z.object({
        query: z.string(),
      }),
    }
  );

  const tools = [searchTool];
  const toolNode = new ToolNode<typeof MessagesAnnotation.State>(tools);
  const model = new ChatOpenAI({ model: "gpt-4o" });

  const boundModel = model.bindTools(tools);

  /* ---------------------------------- edge ---------------------------------- */

  function shouldContinue(
    state: typeof MessagesAnnotation.State
  ): "toolNode" | typeof END {
    const lastMessage = state.messages[state.messages.length - 1];

    if (lastMessage && !(lastMessage as AIMessage).tool_calls?.length) {
      return END;
    }

    return "toolNode";
  }

  /* ---------------------------------- node ---------------------------------- */

  async function callModel(state: typeof MessagesAnnotation.State) {
    const response = await boundModel.invoke(state.messages);
    return { messages: [response] };
  }

  /* -------------------------------- workflow -------------------------------- */

  const workflow = new StateGraph(AgentState)
    .addNode("callModel", callModel)
    .addNode("toolNode", toolNode)
    .addConditionalEdges("callModel", shouldContinue, ["toolNode", END])
    .addEdge("toolNode", "callModel")
    .addEdge(START, "callModel");

  const app = workflow.compile({
    checkpointer: memory,
  });

  // prettier-ignore
  const buffer = (await (await app.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./diagram-manually.png", Buffer.from(await buffer));

  /* --------------------------------- stream --------------------------------- */

  const config = {
    configurable: { thread_id: "2" },
    streamMode: "values" as const,
  };

  const inputMessage = new HumanMessage({
    id: uuidv4(),
    content: "Hi! I'm bob",
  });
  for await (const event of await app.stream(
    {
      messages: [inputMessage],
    },
    config
  )) {
    const recentMsg = event.messages[event.messages.length - 1];
    console.log(
      `================================ ${recentMsg.getType()} Message (1) =================================`
    );
    console.log(recentMsg.content);
    RESULT.push({ [recentMsg.getType()]: recentMsg.content });
  }

  console.log(
    "\n\n================================= END =================================\n\n"
  );

  const inputMessage2 = new HumanMessage({
    id: uuidv4(),
    content: "what's my name?",
  });
  for await (const event of await app.stream(
    {
      messages: [inputMessage2],
    },
    config
  )) {
    const recentMsg = event.messages[event.messages.length - 1];
    console.log(
      `================================ ${recentMsg._getType()} Message (2) =================================`
    );
    console.log(recentMsg.content);
    RESULT.push({ [recentMsg.getType()]: recentMsg.content });
  }

  /* ------------------------------ All messages ------------------------------ */

  let messages: BaseMessage[] = (await app.getState(config)).values.messages;

  RESULT.push("All Messages");
  for (const message of messages) {
    RESULT.push(message);

    console.log({
      id: message.id,
      type: message.getType(),
      content: message.content,
      tool_calls: (message as AIMessage).tool_calls,
    });
  }

  /* ------------------------------- updateState ------------------------------ */

  RESULT.push(`messages.length: ${messages.length}`);
  RESULT.push("Removing the first message", { id: messages[0].id });

  await app.updateState(config, {
    messages: new RemoveMessage({ id: messages[0].id! }),
  });

  messages = (await app.getState(config)).values.messages;

  RESULT.push(`messages.length: ${messages.length}`);

  for (const message of messages) {
    RESULT.push(message);

    console.log({
      id: message.id,
      type: message.getType(),
      content: message.content,
      tool_calls: (message as AIMessage).tool_calls,
    });
  }
  /* --------------------------------- Result --------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT-manually.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
