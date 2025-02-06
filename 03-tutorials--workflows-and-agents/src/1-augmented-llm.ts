import { tool } from "@langchain/core/tools";
import { ChatOllama } from "@langchain/ollama";
import { z } from "zod";
import * as fs from "fs";

(async () => {
  const llm = new ChatOllama({
    model: "llama3.2",
  });
  const searchQuerySchema = z.object({
    searchQuery: z.string().describe("Query that is optimized web search."),
    justification: z
      .string()
      .describe("Why this query is relevant to the user's request"),
  });

  const structureLlm = llm.withStructuredOutput(searchQuerySchema, {
    name: "searchQuery",
  });

  const output = await structureLlm.invoke(
    "How does calcium CT score relate to high cholesterol?"
  );

  const multiply = tool(async ({ a, b }) => a * b, {
    name: "multiply",
    description: "multiplies two numbers together",
    schema: z.object({
      a: z.number().describe("the first number"),
      b: z.number().describe("the second number"),
    }),
  });

  const llmWithTools = llm.bindTools([multiply]);

  const message = await llmWithTools.invoke("What is 2 times 3?");

  // prettier-ignore
  fs.writeFileSync("result-1-augmented-llm.json",JSON.stringify({ output ,message}, null, 2),"utf8");
})();
