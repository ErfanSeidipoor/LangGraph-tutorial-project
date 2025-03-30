import {
  AIMessage,
  isAIMessage,
  RemoveMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { tool } from "@langchain/core/tools";
import { MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
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
      const model = new ChatOpenAI({
        model: "gpt-4o-mini",
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

  // const toolNode = new ToolNode([masterHaikuGenerator]);
  const callTool = async (state: typeof MessagesAnnotation.State) => {
    const { messages } = state;
    const toolsByName = { master_haiku_generator: masterHaikuGenerator };
    const lastMessage = messages[messages.length - 1] as AIMessage;
    const outputMessages: ToolMessage[] = [];

    for (const toolCall of lastMessage.tool_calls ?? []) {
      try {
        const toolResult = await toolsByName[
          toolCall.name as keyof typeof toolsByName
        ].invoke(toolCall);

        outputMessages.push(toolResult);
      } catch (error: any) {
        // Return the error if the tool call fails
        outputMessages.push(
          new ToolMessage({
            content: error.message,
            name: toolCall.name,
            tool_call_id: toolCall.id!,
            additional_kwargs: { error },
          })
        );
      }
    }
    return { messages: outputMessages };
  };

  const model = new ChatOpenAI({
    model: "gpt-4o-mini",
    temperature: 0,
  });
  const modelWithTools = model.bindTools([masterHaikuGenerator]);

  const betterModel = new ChatOpenAI({
    model: "gpt-4o",
    temperature: 0,
  });
  const betterModelWithTools = betterModel.bindTools([masterHaikuGenerator]);

  const shouldContinue = async (state: typeof MessagesAnnotation.State) => {
    const { messages } = state;
    const lastMessage = messages[messages.length - 1];
    if (isAIMessage(lastMessage) && lastMessage.tool_calls?.length) {
      return "tools";
    }
    return "__end__";
  };

  const shouldFallback = async (state: typeof MessagesAnnotation.State) => {
    const { messages } = state;
    const failedToolMessages = messages.find((message) => {
      return (
        message.getType() === "tool" &&
        message.additional_kwargs.error !== undefined
      );
    });
    if (failedToolMessages) {
      return "remove_failed_tool_call_attempt";
    }
    return "agent";
  };

  const callModel = async (state: typeof MessagesAnnotation.State) => {
    const { messages } = state;
    const response = await modelWithTools.invoke(messages);
    return { messages: [response] };
  };

  const removeFailedToolCallAttempt = async (
    state: typeof MessagesAnnotation.State
  ) => {
    const { messages } = state;
    const lastAIMessageIndex = messages
      .map((msg, index) => ({ msg, index }))
      .reverse()
      .findIndex(({ msg }) => isAIMessage(msg));
    const messagesToRemove = messages.slice(lastAIMessageIndex);

    return {
      messages: messagesToRemove.map((m) => new RemoveMessage({ id: m.id! })),
    };
  };

  const callFallbackModel = async (state: typeof MessagesAnnotation.State) => {
    const { messages } = state;
    const response = await betterModelWithTools.invoke(messages);
    return { messages: [response] };
  };

  const app = new StateGraph(MessagesAnnotation)
    .addNode("tools", callTool)
    .addNode("agent", callModel)
    .addNode("remove_failed_tool_call_attempt", removeFailedToolCallAttempt)
    .addNode("fallback_agent", callFallbackModel)
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue, {
      tools: "tools",
      __end__: "__end__",
    })
    .addConditionalEdges("tools", shouldFallback, {
      remove_failed_tool_call_attempt: "remove_failed_tool_call_attempt",
      agent: "agent",
    })
    .addEdge("remove_failed_tool_call_attempt", "fallback_agent")
    .addEdge("fallback_agent", "tools")
    .compile();

  // prettier-ignore
  const buffer = (await (await app.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./diagram-fallback-agent.png", Buffer.from(await buffer));

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
    const toolCalls = isAIMessage(message)
      ? JSON.stringify(message.tool_calls)
      : undefined;
    console.log(`${message.getType().toUpperCase()}: ${content} ${toolCalls}`);
    RESULT.push(`${message.getType().toUpperCase()}: ${content} ${toolCalls}`);
  }

  /* --------------------------------- Result --------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT-fallback-agent.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
