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
import { ChatOpenAI } from "@langchain/openai";
import * as fs from "fs/promises";
import { tool } from "@langchain/core/tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { z } from "zod";

(async () => {
  const RESULT: (object | string)[] = [];

  /* --------------------------------- memory --------------------------------- */

  const messagesMemory = new MemorySaver();

  /* ---------------------------------- model --------------------------------- */

  const model = new ChatOpenAI({ model: "gpt-4o" });

  /* ---------------------------------- tool ---------------------------------- */
  const search = tool(
    () => {
      return "It's sunny in San Francisco, but you better look out if you're a Gemini 😈.";
    },
    {
      name: "search",
      description: "Call to surf the web",
      schema: z.string(),
    }
  );

  const tools = [search];
  const toolNode = new ToolNode<typeof MessagesAnnotation.State>(tools);

  const askHumanTool = tool(
    () => {
      return "the Human seid XYZ";
    },
    {
      name: "askHuman",
      description: "Ask the Human for input",
      schema: z.string(),
    }
  );

  const modelWithTools = model.bindTools([...tools, askHumanTool]);

  /* ---------------------------------- edges --------------------------------- */

  function shouldContinue(
    state: typeof MessagesAnnotation.State
  ): "toolNode" | "askHuman" | typeof END {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;

    if (lastMessage && !lastMessage.tool_calls?.length) {
      return END;
    }

    if (lastMessage.tool_calls?.[0]?.name === "askHuman") {
      console.log("---- ASKING HUMAN ---");
      return "askHuman";
    }

    return "toolNode";
  }

  async function callModel(
    state: typeof MessagesAnnotation.State
  ): Promise<Partial<typeof MessagesAnnotation.State>> {
    const messages = state.messages;
    const response = await modelWithTools.invoke(messages);
    return { messages: [response] };
  }

  function askHuman(
    state: typeof MessagesAnnotation.State
  ): Partial<typeof MessagesAnnotation.State> {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    const toolCallId = lastMessage.tool_calls?.[0].id;
    const location: string = interrupt("Please provide your location:");
    const newToolMessage = new ToolMessage({
      tool_call_id: toolCallId!,
      content: location,
    });
    return { messages: [newToolMessage] };
  }

  /* -------------------------------- workflow -------------------------------- */
  const messagesWorkflow = new StateGraph(MessagesAnnotation)
    // Define the two nodes we will cycle between
    .addNode("callModel", callModel)
    .addNode("toolNode", toolNode)
    .addNode("askHuman", askHuman)
    .addConditionalEdges("callModel", shouldContinue, [
      "askHuman",
      "toolNode",
      END,
    ])
    .addEdge("toolNode", "callModel")
    .addEdge("askHuman", "callModel")
    .addEdge(START, "callModel");

  const messagesApp = messagesWorkflow.compile({
    checkpointer: messagesMemory,
  });

  // prettier-ignore
  const buffer = (await (await messagesApp.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./diagram-agent.png", Buffer.from(await buffer));

  /* --------------------------------- invoke --------------------------------- */
  // Input
  const input = {
    role: "user",
    content:
      "Use the search tool to ask the user where they are, then look up the weather there",
  };

  // Thread
  const config2 = {
    configurable: { thread_id: "3" },
    streamMode: "values" as const,
  };

  for await (const event of await messagesApp.stream(
    {
      messages: [input],
    },
    config2
  )) {
    const recentMsg = event.messages[event.messages.length - 1];
    console.log(
      `================================ ${recentMsg.getType()} Message (1) =================================`
    );
    console.log(recentMsg.content);
    RESULT.push({ [recentMsg.getType()]: recentMsg.content });
  }

  /* ---------------------------------- next ---------------------------------- */

  console.log("next: ", (await messagesApp.getState(config2)).next);
  RESULT.push({ next: (await messagesApp.getState(config2)).next });

  /* --------------------------------- command -------------------------------- */

  for await (const event of await messagesApp.stream(
    new Command({ resume: "San Francisco" }),
    config2
  )) {
    console.log(event);
    console.log("\n====\n");
    RESULT.push({ event });
  }

  /* --------------------------------- result --------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT-agent.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
