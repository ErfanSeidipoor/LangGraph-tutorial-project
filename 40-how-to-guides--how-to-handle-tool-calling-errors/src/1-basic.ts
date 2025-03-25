import { isAIMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOllama } from "@langchain/ollama";
import * as fs from "fs/promises";
import { z } from "zod";

(async () => {
  let RESULT: (object | string)[] = [];

  /* ---------------------------------- tools --------------------------------- */

  const getWeather = tool(
    async ({ location }) => {
      if (location === "SAN FRANCISCO") {
        return "It's 60 degrees and foggy";
      } else if (location.toLowerCase() === "san francisco") {
        throw new Error("Input queries must be all capitals");
      } else {
        throw new Error("Invalid input.");
      }
    },
    {
      name: "get_weather",
      description: "Call to get the current weather",
      schema: z.object({
        location: z.string(),
      }),
    }
  );

  const toolNode = new ToolNode([getWeather]);

  const modelWithTools = new ChatOllama({
    model: "llama3.2",
    temperature: 0,
  }).bindTools([getWeather]);

  /* ---------------------------------- edge ---------------------------------- */

  const shouldContinue = async (state: typeof MessagesAnnotation.State) => {
    const { messages } = state;
    const lastMessage = messages[messages.length - 1];
    if (isAIMessage(lastMessage) && lastMessage.tool_calls?.length) {
      return "tools";
    }
    return "__end__";
  };

  /* ---------------------------------- model --------------------------------- */

  const callModel = async (state: typeof MessagesAnnotation.State) => {
    const { messages } = state;
    const response = await modelWithTools.invoke(messages);
    return { messages: [response] };
  };

  /* ---------------------------------- graph --------------------------------- */

  const app = new StateGraph(MessagesAnnotation)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    .addEdge(START, "agent")
    .addEdge("tools", "agent")
    .addConditionalEdges("agent", shouldContinue, ["__end__", "tools"])
    .compile();

  // prettier-ignore
  const buffer = (await (await app.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./diagram-basic.png", Buffer.from(await buffer));

  /* --------------------------------- stream --------------------------------- */

  const response = await app.invoke({
    messages: [
      { role: "user", content: "what is the weather in san francisco?" },
    ],
  });

  for (const message of response.messages) {
    const content = JSON.stringify(message.content, null, 2);
    console.log(`${message.getType().toUpperCase()}: ${content}`);
    RESULT.push(`${message.getType().toUpperCase()}: ${content}`);
  }

  /* --------------------------------- Result --------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT-basic.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
