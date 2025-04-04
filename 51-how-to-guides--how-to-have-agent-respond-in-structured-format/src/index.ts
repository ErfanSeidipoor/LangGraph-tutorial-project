import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  isAIMessage,
} from "@langchain/core/messages";

import { RunnableConfig } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import { concat } from "@langchain/core/utils/stream";
import {
  Annotation,
  messagesStateReducer,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import * as fs from "fs/promises";
import { z } from "zod";

(async () => {
  let RESULT: (object | string)[] = [];

  const model = new ChatOpenAI({
    temperature: 0,
    model: "gpt-4o",
  });

  const GraphState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
      reducer: messagesStateReducer,
    }),
  });

  const searchTool = tool(
    (_) => {
      // This is a placeholder, but don't tell the LLM that...
      return "67 degrees. Cloudy with a chance of rain.";
    },
    {
      name: "search",
      description: "Call to surf the web.",
      schema: z.object({
        query: z.string().describe("The query to use in your search."),
      }),
    }
  );

  const tools = [searchTool];
  const toolNode = new ToolNode<typeof GraphState.State>(tools);

  const Response = z.object({
    temperature: z.number().describe("the temperature"),
    other_notes: z.string().describe("any other notes about the weather"),
  });

  const finalResponseTool = tool(async () => "mocked value", {
    name: "Response",
    description: "Always respond to the user using this tool.",
    schema: Response,
  });

  const boundModel = model.bindTools([...tools, finalResponseTool]);

  const route = (state: typeof GraphState.State) => {
    const { messages } = state;
    const lastMessage = messages[messages.length - 1] as AIMessage;
    if (!lastMessage.tool_calls || lastMessage.tool_calls.length === 0) {
      return "__end__";
    }
    if (lastMessage.tool_calls[0].name === "Response") {
      return "__end__";
    }
    return "tools";
  };

  const callModel = async (
    state: typeof GraphState.State,
    config?: RunnableConfig
  ) => {
    const { messages } = state;
    const response = await boundModel.invoke(messages, config);
    return { messages: [response] };
  };

  const workflow = new StateGraph(GraphState)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", route, {
      __end__: "__end__",
      tools: "tools",
    })
    .addEdge("tools", "agent");

  const app = workflow.compile();

  // prettier-ignore
  const buffer = (await (await app.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./diagram.png", Buffer.from(await buffer));

  const prettyPrint = (message: BaseMessage) => {
    let txt = `[${message.getType()}]: ${message.content}`;
    if (isAIMessage(message) && message?.tool_calls?.length) {
      const tool_calls = message?.tool_calls
        ?.map((tc) => `- ${tc.name}(${JSON.stringify(tc.args)})`)
        .join("\n");
      txt += ` \nTools: \n${tool_calls}`;
    }
    console.log(txt);
  };

  const inputs = {
    messages: [new HumanMessage("what is the weather in sf")],
  };

  const stream = await app.stream(inputs, { streamMode: "values" });

  for await (const output of stream) {
    const { messages } = output;
    prettyPrint(messages[messages.length - 1]);
    RESULT.push(messages[messages.length - 1]);
    console.log("\n---\n");
  }

  /* ------------------------ Partially streaming JSON ------------------------ */

  const eventStream = await app.streamEvents(inputs, { version: "v2" });

  let aggregatedChunk;
  for await (const { event, data } of eventStream) {
    if (event === "on_chat_model_stream") {
      const { chunk } = data;
      if (aggregatedChunk === undefined) {
        aggregatedChunk = chunk;
      } else {
        aggregatedChunk = concat(aggregatedChunk, chunk);
      }
      const currentToolCalls = aggregatedChunk.tool_calls;
      if (
        currentToolCalls.length === 0 ||
        currentToolCalls[0].name === "" ||
        !finalResponseTool.name.startsWith(currentToolCalls[0].name)
      ) {
        aggregatedChunk = undefined;
      } else if (currentToolCalls[0].name === finalResponseTool.name) {
        console.log(aggregatedChunk.tool_call_chunks[0].args);
        RESULT.push(aggregatedChunk.tool_call_chunks[0].args);
        console.log("---");
      }
    }
  }

  // prettier-ignore
  fs.writeFile("RESULT.json", JSON.stringify(RESULT, null, 2), "utf8");
})();
