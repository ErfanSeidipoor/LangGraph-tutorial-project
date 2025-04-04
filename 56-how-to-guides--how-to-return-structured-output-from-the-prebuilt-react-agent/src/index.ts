import { tool } from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { MemorySaver } from "@langchain/langgraph";
import * as fs from "fs/promises";
import { z } from "zod";

(async () => {
  let RESULT: (object | string)[] = [];

  const weatherTool = tool(
    async (input): Promise<string> => {
      if (input.city === "nyc") {
        return "It might be cloudy in nyc";
      } else if (input.city === "sf") {
        return "It's always sunny in sf";
      } else {
        throw new Error("Unknown city");
      }
    },
    {
      name: "get_weather",
      description: "Use this to get weather information.",
      schema: z.object({
        city: z.enum(["nyc", "sf"]).describe("The city to get weather for"),
      }),
    }
  );

  const WeatherResponseSchema = z.object({
    conditions: z.string().describe("Weather conditions"),
  });

  const tools = [weatherTool];

  const agent = createReactAgent({
    llm: new ChatOpenAI({ model: "gpt-4o", temperature: 0 }),
    tools: tools,
    responseFormat: WeatherResponseSchema,
  });

  const response = await agent.invoke({
    messages: [
      {
        role: "user",
        content: "What's the weather in NYC?",
      },
    ],
  });

  console.log({ response });
  RESULT.push({ response });

  const agent2 = createReactAgent({
    llm: new ChatOpenAI({ model: "gpt-4o", temperature: 0 }),
    tools: tools,
    responseFormat: {
      prompt: "Always return capitalized weather conditions",
      schema: WeatherResponseSchema,
    },
  });

  const response2 = await agent2.invoke({
    messages: [
      {
        role: "user",
        content: "What's the weather in NYC?",
      },
    ],
  });

  console.log({ response2 });
  RESULT.push({ response2 });

  // prettier-ignore
  const buffer = (await (await agent.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./diagram.png", Buffer.from(await buffer));

  // prettier-ignore
  fs.writeFile("RESULT.json", JSON.stringify(RESULT, null, 2), "utf8");
})();
