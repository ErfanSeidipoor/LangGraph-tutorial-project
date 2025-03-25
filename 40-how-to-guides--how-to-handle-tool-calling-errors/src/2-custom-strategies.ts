import { isAIMessage } from "@langchain/core/messages";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { tool } from "@langchain/core/tools";
import { MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOllama } from "@langchain/ollama";
import * as fs from "fs/promises";
import { z } from "zod";

(async () => {
  let RESULT: (object | string)[] = [];

  /* ---------------------------------- tools --------------------------------- */
  const haikuRequestSchema = z.object({
    topic: z.array(z.string()).length(3),
  });

  const masterHaikuGenerator = tool(
    async ({ topic }) => {
      const model = new ChatOllama({
        model: "llama3.2",
        temperature: 0,
      });
      const chain = model.pipe(new StringOutputParser());
      const topics = topic.join(", ");
      const haiku = await chain.invoke(`Write a haiku about ${topics}`);
      return haiku;
    },
    {
      name: "master_haiku_generator",
      description: "Generates a haiku based on the provided topics.",
      schema: haikuRequestSchema,
    }
  );

  const toolNode = new ToolNode([masterHaikuGenerator]);

  const model = new ChatOllama({
    model: "llama3.2",
    temperature: 0,
  });

  const modelWithTools = model.bindTools([masterHaikuGenerator]);

  const shouldContinue = async (state: typeof MessagesAnnotation.State) => {
    const { messages } = state;
    const lastMessage = messages[messages.length - 1];
    if (isAIMessage(lastMessage) && lastMessage.tool_calls?.length) {
      return "tools";
    }
    return "__end__";
  };

  const callModel = async (state: typeof MessagesAnnotation.State) => {
    const { messages } = state;
    const response = await modelWithTools.invoke(messages);
    return { messages: [response] };
  };

  const app = new StateGraph(MessagesAnnotation)
    .addNode("tools", toolNode)
    .addNode("agent", callModel)
    .addEdge("__start__", "agent")
    .addEdge("tools", "agent")
    .addConditionalEdges("agent", shouldContinue, {
      tools: "tools",
      __end__: "__end__",
    })
    .compile();

  // prettier-ignore
  const buffer = (await (await app.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile(
    "./diagram-custom-strategies.png",
    Buffer.from(await buffer)
  );

  /* --------------------------------- stream --------------------------------- */
  const response = await app.invoke(
    {
      messages: [
        { role: "user", content: "Write me an incredible haiku about water." },
      ],
    },
    { recursionLimit: 10 }
  );

  for (const message of response.messages) {
    const content = JSON.stringify(message.content, null, 2);
    console.log(`${message.getType().toUpperCase()}: ${content}`);
    RESULT.push(`${message.getType().toUpperCase()}: ${content}`);
  }

  /* --------------------------------- Result --------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT-custom-strategies.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
