import {
  Annotation,
  Command,
  END,
  interrupt,
  MemorySaver,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { ToolCall } from "@langchain/core/messages/tool";
import { tool } from "@langchain/core/tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";

import * as fs from "fs/promises";
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  ToolMessage,
} from "@langchain/core/messages";

(async () => {
  let RESULT: (object | string)[] = [];

  /* ------------------------------- GraphState ------------------------------- */

  const AgentState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
      reducer: (x, y) => x.concat(y),
    }),
  });

  /* ---------------------------------- tool ---------------------------------- */

  const search = tool(
    (_) => {
      RESULT.push("searchTool");
      return "It's sunny in San Francisco, but you better look out if you're a Gemini 😈.";
    },
    {
      name: "search",
      description: "Call to surf the web.",
      schema: z.string(),
    }
  );
  const tools = [search];
  const toolNode = new ToolNode<typeof AgentState.State>(tools);

  const modelWithTools = new ChatOpenAI({ model: "gpt-4o" }).bindTools(tools);

  /* ------------------------------ callModelNode ----------------------------- */
  async function callModel(
    state: typeof AgentState.State
  ): Promise<Partial<typeof AgentState.State>> {
    const messages = state.messages;
    const response = await modelWithTools.invoke(messages);

    RESULT.push({ callModel: response });
    return { messages: [response] };
  }

  /* ---------------------------------- edge ---------------------------------- */

  function shouldContinue(
    state: typeof AgentState.State
  ): "action" | typeof END {
    const lastMessage = state.messages[state.messages.length - 1];

    RESULT.push({ shouldContinue: lastMessage });
    if (lastMessage && !(lastMessage as AIMessage).tool_calls?.length) {
      return END;
    }
    return "action";
  }

  /* ---------------------------------- graph --------------------------------- */
  const workflow = new StateGraph(AgentState)
    .addNode("agent", callModel)
    .addNode("action", toolNode)
    .addConditionalEdges("agent", shouldContinue)
    .addEdge("action", "agent")
    .addEdge(START, "agent");

  const memory = new MemorySaver();

  const app = workflow.compile({
    checkpointer: memory,
    interruptBefore: ["action"],
  });

  // prettier-ignore
  const buffer = (await (await app.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./diagram-agent.png", Buffer.from(await buffer));

  /* --------------------------------- invoke --------------------------------- */

  const inputs = new HumanMessage("search for the weather in sf now");

  const config = {
    configurable: { thread_id: "3" },
    streamMode: "values" as const,
  };

  for await (const event of await app.stream(
    {
      messages: [inputs],
    },
    config
  )) {
    const recentMsg = event.messages[event.messages.length - 1];

    console.log(
      `================================ ${recentMsg._getType()} Message (1) =================================`
    );
    RESULT.push({ [recentMsg.getType()]: recentMsg.content });
    console.log(recentMsg.content);
  }

  RESULT.push(`==== interrupt =====`);

  for await (const event of await app.stream(null, config)) {
    const recentMsg = event.messages[event.messages.length - 1];
    console.log(
      `================================ ${recentMsg._getType()} Message (1) =================================`
    );
    RESULT.push({ [recentMsg.getType()]: recentMsg.content });
    console.log(recentMsg.content);
  }

  /* --------------------------------- Result --------------------------------- */
  // prettier-ignore
  fs.writeFile("RESULT-agent.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
