import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { ChatOllama } from "@langchain/ollama";
import * as fs from "fs";
import { z } from "zod";

(async () => {
  const llm = new ChatOllama({
    model: "llama3.2",
  });

  const multiply = tool(
    async ({ a, b }: { a: string; b: string }) => Number(a) * Number(b),
    {
      name: "multiply",
      description: "Multiply two numbers together",
      schema: z.object({
        a: z.string().describe("First number"),
        b: z.string().describe("Second number"),
      }),
    }
  );

  const add = tool(
    async ({ a, b }: { a: string; b: string }) => String(Number(a) + Number(b)),
    {
      name: "add",
      description: "Add two numbers together",
      schema: z.object({
        a: z.string().describe("First number"),
        b: z.string().describe("Second number"),
      }),
    }
  );

  const divide = tool(
    async ({ a, b }: { a: string; b: string }) => {
      return Number(a) / Number(b);
    },
    {
      name: "divide",
      description: "Divide two numbers",
      schema: z.object({
        a: z.string().describe("first number"),
        b: z.string().describe("second number"),
      }),
    }
  );

  const tools = [multiply, add, divide];
  const toolsByName = Object.fromEntries(
    tools.map((tool) => [tool.name, tool])
  );

  const llmWithTools = llm.bindTools(tools);

  async function startNode(state: typeof MessagesAnnotation.State) {
    const result = await llmWithTools.invoke([
      {
        role: "system",
        content:
          "You are a helpful assistant tasked with performing arithmetic on a set of inputs.",
      },
      ...state.messages,
    ]);

    console.log({ result });

    return { messages: result };
  }

  async function toolsNode(state: typeof MessagesAnnotation.State) {
    const results: ToolMessage[] = [];
    const lastMessage = state.messages.at(-1) as AIMessage;

    console.log({ lastMessage });

    if (lastMessage?.tool_calls?.length) {
      for (const toolCall of lastMessage.tool_calls) {
        const tool = toolsByName[toolCall.name];
        // @ts-ignore
        const observation = await tool.invoke(toolCall.args);
        results.push(
          new ToolMessage({
            content: observation,
            tool_call_id: toolCall.id!,
          })
        );
      }
    }
    return { messages: results };
  }

  function shouldContinue(state: typeof MessagesAnnotation.State) {
    const messages = state.messages;
    const lastMessage = messages.at(-1) as AIMessage;

    // If the LLM makes a tool call, then perform an action
    if (lastMessage?.tool_calls?.length) {
      return "Action";
    }
    // Otherwise, we stop (reply to the user)
    return "__end__";
  }

  const agentBuilder = new StateGraph(MessagesAnnotation)
    .addNode("startNode", startNode)
    .addNode("toolsNode", toolsNode)
    .addEdge("__start__", "startNode")
    .addConditionalEdges("startNode", shouldContinue, {
      Action: "toolsNode",
      __end__: "__end__",
    })
    .addEdge("toolsNode", "startNode")
    .compile();

  const messages = [
    {
      role: "user",
      content: "Add 3 and 4.",
    },
  ];
  const result = await agentBuilder.invoke({ messages });

  // prettier-ignore
  const buffer = (await (await agentBuilder.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  fs.writeFileSync("./graph-8-agent.png", Buffer.from(await buffer));

  // prettier-ignore
  fs.writeFileSync("result-8-agent.json",JSON.stringify({ result }, null, 2),"utf8");
})();
