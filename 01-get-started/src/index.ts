import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { MemorySaver } from "@langchain/langgraph";
import { ChatOllama } from "@langchain/ollama";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import * as fs from "fs";

(async () => {
  const search = tool(
    async ({ query }: { query: string }) => {
      if (
        query.toLowerCase().includes("sf") ||
        query.toLowerCase().includes("san francisco")
      ) {
        return "It's 60 degrees and foggy.";
      }
      return "It's 90 degrees and sunny.";
    },
    {
      name: "search",
      description: "Call to surf the web",
      schema: z.object({
        query: z.string().describe("The query to use in your search"),
      }),
    }
  );

  const tools = [search];

  const model = new ChatOllama({
    model: "llama3.2",
    temperature: 0,
  });

  const checkpointSaver = new MemorySaver();

  const app = createReactAgent({
    llm: model,
    tools,
    checkpointSaver,
  });

  const result = await app.invoke(
    {
      messages: [
        {
          role: "user",
          content: "what is the weather in SF? temperature?",
        },
      ],
    },
    {
      configurable: { thread_id: 42 },
    }
  );

  console.log(result.messages);

  const followup = await app.invoke(
    {
      messages: [
        {
          role: "user",
          content: "what about ny",
        },
      ],
    },
    { configurable: { thread_id: 42 } }
  );

  console.log(followup.messages.at(-1)?.content);

  // prettier-ignore
  fs.writeFileSync("result.json",JSON.stringify({ result, followup }, null, 2),"utf8");
})();
