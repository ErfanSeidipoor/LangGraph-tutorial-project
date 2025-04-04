import { tool } from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import * as fs from "fs/promises";
import { z } from "zod";
import { MemorySaver } from "@langchain/langgraph";

(async () => {
  let RESULT: (object | string)[] = [];

  const model = new ChatOpenAI({
    model: "gpt-4o",
  });

  const getWeather = tool(
    (input) => {
      if (input.location === "sf") {
        return "It's always sunny in sf";
      } else {
        return "It might be cloudy in nyc";
      }
    },
    {
      name: "get_weather",
      description: "Call to get the current weather.",
      schema: z.object({
        location: z
          .enum(["sf", "nyc"])
          .describe("Location to get the weather for."),
      }),
    }
  );

  const memory = new MemorySaver();

  const agent = createReactAgent({
    llm: model,
    tools: [getWeather],
    checkpointSaver: memory,
  });

  let inputs = {
    messages: [{ role: "user", content: "what is the weather in NYC?" }],
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
  }

  inputs = { messages: [{ role: "user", content: "What's it known for?" }] };
  stream = await agent.stream(inputs, {
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
  }

  inputs = {
    messages: [{ role: "user", content: "how close is it to boston?" }],
  };
  config = { configurable: { thread_id: "2" } };
  stream = await agent.stream(inputs, {
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
  }

  // prettier-ignore
  const buffer = (await (await agent.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./diagram.png", Buffer.from(await buffer));

  // prettier-ignore
  fs.writeFile("RESULT.json", JSON.stringify(RESULT, null, 2), "utf8");
})();
