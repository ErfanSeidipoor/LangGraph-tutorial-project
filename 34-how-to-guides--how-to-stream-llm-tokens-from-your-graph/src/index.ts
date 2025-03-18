import { tool } from "@langchain/core/tools";
import { Annotation, END, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

import {
  AIMessage,
  BaseMessageLike,
  isAIMessageChunk,
} from "@langchain/core/messages";
import * as fs from "fs/promises";

(async () => {
  let RESULT: (object | string)[] = [];

  /* ------------------------------- GraphState ------------------------------- */

  const StateAnnotation = Annotation.Root({
    messages: Annotation<BaseMessageLike[]>({
      reducer: (x, y) => x.concat(y),
    }),
  });

  /* ---------------------------------- tool ---------------------------------- */

  const searchTool = tool(
    (_) => {
      // This is a placeholder for the actual implementation
      return "Cold, with a low of 3℃";
    },
    {
      name: "search",
      description:
        "Use to surf the web, fetch current information, check the weather, and retrieve other information.",
      schema: z.object({
        query: z.string().describe("The query to use in your search."),
      }),
    }
  );

  await searchTool.invoke({ query: "What's the weather like?" });

  const tools = [searchTool];
  const toolNode = new ToolNode(tools);

  /* ---------------------------------- model --------------------------------- */

  const model = new ChatOpenAI({
    model: "gpt-4o-mini",
    temperature: 0,
    streaming: true,
  });
  const boundModel = model.bindTools(tools);

  /* ---------------------------------- graph --------------------------------- */

  const routeMessage = (state: typeof StateAnnotation.State) => {
    const { messages } = state;
    const lastMessage = messages[messages.length - 1] as AIMessage;
    if (!lastMessage?.tool_calls?.length) {
      return END;
    }
    return "tools";
  };

  const callModel = async (state: typeof StateAnnotation.State) => {
    const { messages } = state;
    const responseMessage = await boundModel.invoke(messages);
    return { messages: [responseMessage] };
  };

  const workflow = new StateGraph(StateAnnotation)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", routeMessage)
    .addEdge("tools", "agent");

  const agent = workflow.compile();

  /* --------------------------------- stream --------------------------------- */
  const stream = await agent.stream(
    {
      messages: [
        { role: "user", content: "What's the current weather in Nepal?" },
      ],
    },
    { streamMode: "messages" }
  );

  RESULT.push(`------ .stream( { streamMode: "messages" }) ------`);
  for await (const [message, _metadata] of stream) {
    if (isAIMessageChunk(message) && message.tool_call_chunks?.length) {
      console.log(
        `${message.getType()} MESSAGE TOOL CALL CHUNK: ${
          message.tool_call_chunks[0].args
        }`
      );
      RESULT.push({ [message.getType()]: message.tool_call_chunks[0].args });
    } else {
      console.log(`${message.getType()} MESSAGE CONTENT: ${message.content}`);
      RESULT.push({ [message.getType()]: message.content });
    }
  }

  /* ------------------------------- streamEvent ------------------------------ */

  RESULT.push(`------ .streamEvents( { version: "v2" }) ------`);

  const eventStream = await agent.streamEvents(
    { messages: [{ role: "user", content: "What's the weather like today?" }] },
    {
      version: "v2",
    }
  );

  for await (const { event, data } of eventStream) {
    if (event === "on_chat_model_stream" && isAIMessageChunk(data.chunk)) {
      RESULT.push(data.chunk);

      if (
        data.chunk.tool_call_chunks !== undefined &&
        data.chunk.tool_call_chunks.length > 0
      ) {
        console.log(data.chunk.tool_call_chunks);
      }
    }
  }

  /* --------------------------------- Result --------------------------------- */
  // prettier-ignore
  fs.writeFile("RESULT.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
