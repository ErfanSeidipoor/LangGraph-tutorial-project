import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import {
  Annotation,
  END,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import * as fs from "fs/promises";
import { z } from "zod";

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
  const toolNode = new ToolNode<typeof AgentState.State>(tools);
  const model = new ChatOpenAI({ model: "gpt-4o" });

  const boundModel = model.bindTools(tools);

  /* ---------------------------------- edge ---------------------------------- */

  function shouldContinue(
    state: typeof AgentState.State
  ): "toolNode" | typeof END {
    const lastMessage = state.messages[state.messages.length - 1];

    if (lastMessage && !(lastMessage as AIMessage).tool_calls?.length) {
      return END;
    }

    return "toolNode";
  }

  /* ---------------------------------- node ---------------------------------- */
  const filterMessages = (messages: BaseMessage[]): BaseMessage[] => {
    // This is very simple helper function which only ever uses the last message
    return messages.slice(-1);
  };

  async function callModel(state: typeof AgentState.State) {
    const response = await boundModel.invoke(filterMessages(state.messages));
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

  /* --------------------------------- stream --------------------------------- */

  const config = {
    configurable: { thread_id: "2" },
    streamMode: "values" as const,
  };

  const inputMessage = new HumanMessage("Hi! I'm bob");
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

  const inputMessage2 = new HumanMessage("what's my name?");
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

  /* --------------------------------- Result --------------------------------- */

  // prettier-ignore
  const buffer = (await (await app.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./diagram.png", Buffer.from(await buffer));

  // prettier-ignore
  fs.writeFile("RESULT.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
