import { tool } from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

import * as fs from "fs/promises";

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

  const graph = createReactAgent({ llm: model, tools: [getWeather] });

  let inputs = {
    messages: [{ role: "user", content: "what's the weather in sf?" }],
  };

  let stream = await graph.stream(inputs, {
    streamMode: ["updates", "debug"],
  });

  for await (const chunk of stream) {
    console.log(`Receiving new event of type: ${chunk[0]}`);
    console.log(chunk[1]);
    console.log("\n====\n");
    RESULT.push({ [chunk[0]]: chunk[1] });
  }

  /* --------------------------------- Result --------------------------------- */
  // prettier-ignore
  fs.writeFile("RESULT.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
