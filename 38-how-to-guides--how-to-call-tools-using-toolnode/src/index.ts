import { tool } from "@langchain/core/tools";
import {
  END,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

import { AIMessage } from "@langchain/core/messages";

import * as fs from "fs/promises";

(async () => {
  let RESULT: (object | string)[] = [];

  /* ---------------------------------- tools --------------------------------- */

  const getWeather = tool(
    (input) => {
      if (["sf", "san francisco"].includes(input.location.toLowerCase())) {
        return "It's 60 degrees and foggy.";
      } else {
        return "It's 90 degrees and sunny.";
      }
    },
    {
      name: "get_weather",
      description: "Call to get the current weather.",
      schema: z.object({
        location: z.string().describe("Location to get the weather for."),
      }),
    }
  );

  const getCoolestCities = tool(
    () => {
      return "nyc, sf";
    },
    {
      name: "get_coolest_cities",
      description: "Get a list of coolest cities",
      schema: z.object({
        noOp: z.string().optional().describe("No-op parameter."),
      }),
    }
  );

  const tools = [getWeather, getCoolestCities];
  const toolNode = new ToolNode(tools);

  /* --------------------------------- example -------------------------------- */

  const messageWithSingleToolCall = new AIMessage({
    content: "",
    tool_calls: [
      {
        name: "get_weather",
        args: { location: "sf" },
        id: "tool_call_id",
        type: "tool_call",
      },
    ],
  });

  let result = await toolNode.invoke({
    messages: [messageWithSingleToolCall],
  });
  RESULT.push(result);

  /* -------------------------- parallel tool calling ------------------------- */
  const messageWithMultipleToolCalls = new AIMessage({
    content: "",
    tool_calls: [
      {
        name: "get_coolest_cities",
        args: {},
        id: "tool_call_id",
        type: "tool_call",
      },
      {
        name: "get_weather",
        args: { location: "sf" },
        id: "tool_call_id_2",
        type: "tool_call",
      },
    ],
  });

  result = await toolNode.invoke({ messages: [messageWithMultipleToolCalls] });
  RESULT.push(result);

  /* ---------------------------------- model --------------------------------- */

  const modelWithTools = new ChatOpenAI({
    model: "gpt-4o-mini",
    temperature: 0,
  }).bindTools(tools);

  /* --------------------------------- invoke --------------------------------- */

  result = await modelWithTools.invoke("what's the weather in sf?");

  RESULT.push(result);

  result = await toolNode.invoke({
    messages: [await modelWithTools.invoke("what's the weather in sf?")],
  });

  RESULT.push(result);

  /* ------------------------------- ReAct Agent ------------------------------ */

  const toolNodeForGraph = new ToolNode(tools);

  const shouldContinue = (state: typeof MessagesAnnotation.State) => {
    const { messages } = state;
    const lastMessage = messages[messages.length - 1];
    if (
      "tool_calls" in lastMessage &&
      Array.isArray(lastMessage.tool_calls) &&
      lastMessage.tool_calls?.length
    ) {
      return "tools";
    }
    return END;
  };

  const callModel = async (state: typeof MessagesAnnotation.State) => {
    const { messages } = state;
    const response = await modelWithTools.invoke(messages);
    return { messages: response };
  };

  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("agent", callModel)
    .addNode("tools", toolNodeForGraph)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", shouldContinue, ["tools", END])
    .addEdge("tools", "agent");

  const app = workflow.compile();

  // prettier-ignore
  const buffer = (await (await app.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./diagram.png", Buffer.from(await buffer));

  /* --------------------- example with a single tool call -------------------- */

  const stream = await app.stream(
    {
      messages: [{ role: "user", content: "what's the weather in sf?" }],
    },
    {
      streamMode: "values",
    }
  );
  for await (const chunk of stream) {
    const lastMessage = chunk.messages[chunk.messages.length - 1];
    const type = lastMessage._getType();
    const content = lastMessage.content;
    const toolCalls = lastMessage.tool_calls;
    console.dir(
      {
        type,
        content,
        toolCalls,
      },
      { depth: null }
    );

    RESULT.push({ type, content, toolCalls });
  }

  /* ------------------- example with a multiple tool calls ------------------- */

  const streamWithMultiToolCalls = await app.stream(
    {
      messages: [
        { role: "user", content: "what's the weather in the coolest cities?" },
      ],
    },
    {
      streamMode: "values",
    }
  );
  for await (const chunk of streamWithMultiToolCalls) {
    const lastMessage = chunk.messages[chunk.messages.length - 1];
    const type = lastMessage._getType();
    const content = lastMessage.content;
    const toolCalls = lastMessage.tool_calls;
    console.dir(
      {
        type,
        content,
        toolCalls,
      },
      { depth: null }
    );
    RESULT.push({ type, content, toolCalls });
  }

  /* --------------------------------- Result --------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
