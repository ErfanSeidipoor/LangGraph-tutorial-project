import { tool } from "@langchain/core/tools";
import { MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import * as fs from "fs/promises";

(async () => {
  let RESULT: (object | string)[] = [];

  const model = new ChatOpenAI({
    model: "gpt-4o-mini",
  });

  const getWeather = tool(
    async ({ city }) => {
      if (city === "nyc") {
        return "It might be cloudy in nyc";
      } else if (city === "sf") {
        return "It's always sunny in sf";
      } else {
        throw new Error("Unknown city.");
      }
    },
    {
      name: "get_weather",
      schema: z.object({
        city: z.enum(["nyc", "sf"]),
      }),
      description: "Use this to get weather information",
    }
  );

  const tools = [getWeather];

  const finalModel = model.withConfig({
    tags: ["final_node"],
  });

  const shouldContinue = async (state: typeof MessagesAnnotation.State) => {
    const messages = state.messages;
    const lastMessage: AIMessage = messages[messages.length - 1];
    if (lastMessage.tool_calls?.length) {
      return "tools";
    }
    return "final";
  };

  const callModel = async (state: typeof MessagesAnnotation.State) => {
    const messages = state.messages;
    const response = await model.invoke(messages);
    return { messages: [response] };
  };

  const callFinalModel = async (state: typeof MessagesAnnotation.State) => {
    const messages = state.messages;
    const lastAIMessage = messages[messages.length - 1];
    const response = await finalModel.invoke([
      new SystemMessage("Rewrite this in the voice of Al Roker"),
      new HumanMessage({ content: lastAIMessage.content }),
    ]);
    response.id = lastAIMessage.id;
    return { messages: [response] };
  };

  const toolNode = new ToolNode<typeof MessagesAnnotation.State>(tools);

  const graph = new StateGraph(MessagesAnnotation)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    .addNode("final", callFinalModel)
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue, {
      tools: "tools",
      final: "final",
    })
    .addEdge("tools", "agent")
    .addEdge("final", "__end__")
    .compile();

  // prettier-ignore
  // const buffer = (await (await graph.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  // await fs.writeFile("./diagram.png", Buffer.from(await buffer));

  /* --------------------------------- stream --------------------------------- */
  const inputs = { messages: [new HumanMessage("What's the weather in nyc?")] };

  const eventStream = await graph.streamEvents(inputs, { version: "v2" });

  for await (const { event, tags, data } of eventStream) {
    if (
      event === "on_chat_model_stream" &&
      tags &&
      tags.includes("final_node")
    ) {
      if (data.chunk.content) {
        console.log("final_node > ", data.chunk.content, "|");
      }
    } else {
      console.log(data.chunk.content);
    }
  }

  /* --------------------------------- Result --------------------------------- */
  // prettier-ignore
  fs.writeFile("RESULT.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
