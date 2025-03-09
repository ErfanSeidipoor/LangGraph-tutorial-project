import { tool } from "@langchain/core/tools";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import * as fs from "fs/promises";
import { z } from "zod";

(async () => {
  const RESULT: (object | string)[] = [];

  /* ---------------------------------- State --------------------------------- */

  /* -------------------------- checkpointer method 1 ------------------------- */

  // const { Pool } = pg;
  // const pool = new Pool({
  //   connectionString: process.env["POSTGRES_CONNECTION_STRING"],
  // });

  // const checkpointSaver = new PostgresSaver(pool);
  // await checkpointSaver.setup();

  /* -------------------------- checkpointer method 2 ------------------------- */

  const checkpointSaver = PostgresSaver.fromConnString(
    process.env["POSTGRES_CONNECTION_STRING"]!
  );

  /* ----------------------------- tool and model ----------------------------- */

  const model = new ChatOpenAI({ model: "gpt-4o" });

  const getWeather = tool(
    async (input: { city: "sf" | "nyc" }) => {
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
        city: z.enum(["sf", "nyc"]),
      }),
    }
  );

  const graph = createReactAgent({
    tools: [getWeather],
    llm: model,
    checkpointSaver,
  });
  const config = { configurable: { thread_id: "2" } };

  const response = await graph.invoke(
    {
      messages: [
        {
          role: "user",
          content: "what's the weather in sf",
        },
      ],
    },
    config
  );

  RESULT.push(response);

  const retrieve = await checkpointSaver.get(config);

  RESULT.push(retrieve!);

  /* --------------------------------- Result --------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
