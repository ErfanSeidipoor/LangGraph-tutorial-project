import { tool } from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import * as fs from "fs/promises";
import { z } from "zod";

(async () => {
  let RESULT: (object | string)[] = [];

  const model = new ChatOpenAI({
    model: "gpt-4o",
  });

  const getWeather = tool(
    (input) => {
      if (
        ["sf", "san francisco", "san francisco, ca"].includes(
          input.location.toLowerCase()
        )
      ) {
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

  const agent = createReactAgent({ llm: model, tools: [getWeather] });

  // prettier-ignore
  const buffer = (await (await agent.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./diagram.png", Buffer.from(await buffer));

  /* --------------------------------- stream --------------------------------- */

  let inputs = {
    messages: [{ role: "user", content: "what is the weather in SF?" }],
  };

  let stream = await agent.stream(inputs, {
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

  inputs = { messages: [{ role: "user", content: "who built you?" }] };

  stream = await agent.stream(inputs, {
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
  fs.writeFile("RESULT.json", JSON.stringify(RESULT, null, 2), "utf8");
})();
