import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import { ChatOllama } from "@langchain/ollama";
import { MemorySaver } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import * as fs from "fs";

(async () => {
  const agentTools = [new TavilySearchResults({ maxResults: 3 })];
  const agentModel = new ChatOllama({ model: "llama3.2", temperature: 0 });

  const agentCheckPointer = new MemorySaver();

  const agent = createReactAgent({
    llm: agentModel,
    tools: agentTools,
    checkpointSaver: agentCheckPointer,
  });

  const agentFinalState = await agent.invoke(
    {
      messages: [new HumanMessage("Whats is the current weather in SF?")],
    },
    {
      configurable: { thread_id: 42 },
    }
  );

  const agentNextState = await agent.invoke(
    { messages: [new HumanMessage("what about ny")] },
    { configurable: { thread_id: "42" } }
  );

  // prettier-ignore
  const buffer = (await (await agent.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  fs.writeFileSync("./graph.png", Buffer.from(await buffer));

  // prettier-ignore
  fs.writeFileSync("result.json",JSON.stringify({ agentFinalState, agentNextState }, null, 2),"utf8");
})();
