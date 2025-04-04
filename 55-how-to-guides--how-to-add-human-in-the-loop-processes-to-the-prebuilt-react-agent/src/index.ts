import { tool } from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { MemorySaver } from "@langchain/langgraph";
import * as fs from "fs/promises";
import { z } from "zod";

(async () => {
  let RESULT: (object | string)[] = [];
  const model = new ChatOpenAI({
    model: "gpt-4o",
  });

  const getWeather = tool(
    (input) => {
      if (["sf", "san francisco"].includes(input.location.toLowerCase())) {
        return "It's always sunny in sf";
      } else if (
        ["nyc", "new york city"].includes(input.location.toLowerCase())
      ) {
        return "It might be cloudy in nyc";
      } else {
        throw new Error("Unknown Location");
      }
    },
    {
      name: "get_weather",
      description: "Call to get the current weather in a given location.",
      schema: z.object({
        location: z.string().describe("Location to get the weather for."),
      }),
    }
  );

  // Here we only save in-memory
  const memory = new MemorySaver();

  const agent = createReactAgent({
    llm: model,
    tools: [getWeather],
    interruptBefore: ["tools"],
    checkpointSaver: memory,
  });

  let inputs = {
    messages: [
      { role: "user", content: "what is the weather in SF california?" },
    ],
  };
  let config = { configurable: { thread_id: "1" } };

  let stream = await agent.stream(inputs, {
    ...config,
    streamMode: "values",
  });

  for await (const { messages } of stream) {
    let msg = messages[messages?.length - 1];
    if (msg?.content) {
      console.log(msg.content);
      RESULT.push(msg.content);
    } else if (msg?.tool_calls?.length > 0) {
      console.log(msg.tool_calls);
      RESULT.push(msg.tool_calls);
    } else {
      console.log(msg);
      RESULT.push(msg);
    }
    console.log("-----\n");
    RESULT.push(msg);
  }

  const state = await agent.getState(config);
  console.log(state.next);
  RESULT.push(state.next);

  stream = await agent.stream(null, {
    ...config,
    streamMode: "values",
  });

  for await (const { messages } of stream) {
    let msg = messages[messages?.length - 1];
    if (msg?.content) {
      console.log(msg.content);
      RESULT.push(msg.content);
    }
    if (msg?.tool_calls?.length > 0) {
      console.log(msg.tool_calls);
      RESULT.push(msg.tool_calls);
    }
    console.log("-----\n");
  }

  const currentState = await agent.getState(config);
  let lastMessage =
    currentState.values.messages[currentState.values.messages.length - 1];

  lastMessage.tool_calls[0].args = { location: "San Francisco" };

  await agent.updateState(config, { messages: lastMessage });

  stream = await agent.stream(null, {
    ...config,
    streamMode: "values",
  });

  for await (const { messages } of stream) {
    let msg = messages[messages?.length - 1];
    if (msg?.content) {
      console.log(msg.content);
      RESULT.push(msg.content);
    }
    if (msg?.tool_calls?.length > 0) {
      console.log(msg.tool_calls);
      RESULT.push(msg.tool_calls);
    }
    console.log("-----\n");
  }

  // prettier-ignore
  const buffer = (await (await agent.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./diagram.png", Buffer.from(await buffer));

  // prettier-ignore
  fs.writeFile("RESULT.json", JSON.stringify(RESULT, null, 2), "utf8");
})();
