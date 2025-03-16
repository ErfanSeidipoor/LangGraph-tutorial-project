import {
  Annotation,
  Command,
  END,
  interrupt,
  MemorySaver,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { ToolCall } from "@langchain/core/messages/tool";
import { tool } from "@langchain/core/tools";

import * as fs from "fs/promises";
import { AIMessage, ToolMessage } from "@langchain/core/messages";

(async () => {
  let RESULT: (object | string)[] = [];

  /* ---------------------------------- tool ---------------------------------- */

  const weatherSearchTool = tool(
    (input) => {
      console.log("----");
      console.log(`Searching for: ${input.city}`);
      console.log("----");
      RESULT.push({ "tool > weatherSearch": input.city });
      return "Sunny!";
    },
    {
      name: "weatherSearchTool",
      description: "Search for the weather",
      schema: z.object({
        city: z.string(),
      }),
    }
  );

  /* ---------------------------------- model --------------------------------- */

  const model = new ChatOpenAI({ model: "gpt-4o" }).bindTools([
    weatherSearchTool,
  ]);

  /* ------------------------------- callLlmNode ------------------------------ */

  const callLlmNode = async (state: typeof MessagesAnnotation.State) => {
    const response = await model.invoke(state.messages);
    RESULT.push({ callLlmNode: response });
    return { messages: [response] };
  };

  /* ----------------------------- humanReviewNode ---------------------------- */
  const humanReviewNode = async (
    state: typeof MessagesAnnotation.State
  ): Promise<Command> => {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    const toolCall =
      lastMessage.tool_calls![lastMessage.tool_calls!.length - 1];

    const humanReview = interrupt<
      {
        question: string;
        toolCall: ToolCall;
      },
      {
        action: "continue" | "update" | "feedback";
        data: any;
      }
    >({
      question: "Is this correct?",
      toolCall: toolCall,
    });

    const reviewAction = humanReview.action;
    const reviewData = humanReview.data;

    RESULT.push({ humanReviewNode: { reviewAction, reviewData } });

    if (reviewAction === "continue") {
      RESULT.push({ goto: "toolNode" });
      return new Command({ goto: "toolNode" });
    } else if (reviewAction === "update") {
      const updatedMessage = {
        role: "ai",
        content: lastMessage.content,
        tool_calls: [
          {
            id: toolCall.id,
            name: toolCall.name,
            args: reviewData,
          },
        ],
        id: lastMessage.id,
      };

      RESULT.push({
        goto: "toolNode",
        update: { messages: [updatedMessage] },
      });

      return new Command({
        goto: "toolNode",
        update: { messages: [updatedMessage] },
      });
    } else if (reviewAction === "feedback") {
      const toolMessage = new ToolMessage({
        name: toolCall.name,
        content: reviewData,
        tool_call_id: toolCall.id!,
      });

      RESULT.push({
        goto: "callLlmNode",
        update: { messages: [toolMessage] },
      });

      return new Command({
        goto: "callLlmNode",
        update: { messages: [toolMessage] },
      });
    }
    throw new Error("Invalid review action");
  };

  /* -------------------------------- toolNode -------------------------------- */

  const toolNode = async (state: typeof MessagesAnnotation.State) => {
    const newMessages: ToolMessage[] = [];
    const tools = { weatherSearchTool };
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    const toolCalls = lastMessage.tool_calls!;

    RESULT.push({ toolNode: toolCalls });

    for (const toolCall of toolCalls) {
      const tool = tools[toolCall.name as keyof typeof tools];
      // @ts-ignore
      const result = await tool.invoke(toolCall.args);
      newMessages.push(
        new ToolMessage({
          name: toolCall.name,
          content: result,
          tool_call_id: toolCall.id!,
        })
      );
    }
    return { messages: newMessages };
  };

  /* ---------------------------------- edge ---------------------------------- */

  const routeAfterLlmEdge = (
    state: typeof MessagesAnnotation.State
  ): typeof END | "humanReviewNode" => {
    RESULT.push("routeAfterLlmEdge");

    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    if (!lastMessage.tool_calls?.length) {
      return END;
    }
    return "humanReviewNode";
  };

  /* -------------------------------- workflow -------------------------------- */

  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("callLlmNode", callLlmNode)
    .addNode("toolNode", toolNode)
    .addNode("humanReviewNode", humanReviewNode, {
      ends: ["toolNode", "callLlmNode"],
    })
    .addEdge(START, "callLlmNode")
    .addConditionalEdges("callLlmNode", routeAfterLlmEdge, [
      "humanReviewNode",
      END,
    ])
    .addEdge("toolNode", "callLlmNode");

  const memory = new MemorySaver();
  const graph = workflow.compile({ checkpointer: memory });

  // prettier-ignore
  const buffer = (await (await graph.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./diagram.png", Buffer.from(await buffer));

  /* -------------------------------------------------------------------------- */
  /*                                  Thread 1                                  */
  /* -------------------------------------------------------------------------- */

  let inputs = { messages: [{ role: "user", content: "hi!" }] };
  let config = {
    configurable: { thread_id: "1" },
    streamMode: "values" as const,
  };

  let stream = await graph.stream(inputs, config);

  for await (const event of stream) {
    const recentMsg = event.messages[event.messages.length - 1];
    console.log(
      `================================ ${recentMsg._getType()} Message (1) =================================`
    );
    console.log(recentMsg.content);
  }

  let state = await graph.getState(config);

  RESULT.push(state.next);
  console.log(state.next);

  // prettier-ignore
  fs.writeFile("RESULT-1.json",JSON.stringify(RESULT, null, 2),"utf8");

  /* -------------------------------------------------------------------------- */
  /*                             Thread 2  CONTINUE                             */
  /* -------------------------------------------------------------------------- */

  RESULT = [];
  inputs = {
    messages: [{ role: "user", content: "what's the weather in SF?" }],
  };
  config = { configurable: { thread_id: "2" }, streamMode: "values" as const };

  stream = await graph.stream(inputs, config);

  for await (const event of stream) {
    const recentMsg = event.messages[event.messages.length - 1];
    console.log(
      `================================ ${recentMsg._getType()} Message (1) =================================`
    );
    console.log(recentMsg.content);
  }

  state = await graph.getState(config);

  RESULT.push(state.next);
  console.log(state.next);

  for await (const event of await graph.stream(
    new Command({ resume: { action: "continue" } }),
    config
  )) {
    const recentMsg = event.messages[event.messages.length - 1];
    console.log(
      `================================ ${recentMsg._getType()} Message (1) =================================`
    );
    console.log(recentMsg.content);
  }
  // prettier-ignore
  fs.writeFile("RESULT-2.json",JSON.stringify(RESULT, null, 2),"utf8");

  /* -------------------------------------------------------------------------- */
  /*                              Thread 3  UPDATE                              */
  /* -------------------------------------------------------------------------- */

  RESULT = [];

  inputs = {
    messages: [{ role: "user", content: "what's the weather in SF?" }],
  };
  config = { configurable: { thread_id: "3" }, streamMode: "values" as const };

  stream = await graph.stream(inputs, config);

  for await (const event of stream) {
    const recentMsg = event.messages[event.messages.length - 1];
    console.log(
      `================================ ${recentMsg._getType()} Message (1) =================================`
    );
    console.log(recentMsg.content);
  }

  state = await graph.getState(config);

  RESULT.push(state.next);
  console.log(state.next);

  for await (const event of await graph.stream(
    new Command({
      resume: {
        action: "update",
        data: { city: "San Francisco" },
      },
    }),
    config
  )) {
    const recentMsg = event.messages[event.messages.length - 1];
    console.log(
      `================================ ${recentMsg._getType()} Message (1) =================================`
    );
    console.log(recentMsg.content);
  }

  // prettier-ignore
  fs.writeFile("RESULT-3.json",JSON.stringify(RESULT, null, 2),"utf8");

  /* -------------------------------------------------------------------------- */
  /*                            Thread 4  FEEDBACK                              */
  /* -------------------------------------------------------------------------- */

  RESULT = [];

  inputs = {
    messages: [{ role: "user", content: "what's the weather in SF?" }],
  };
  config = { configurable: { thread_id: "4" }, streamMode: "values" as const };

  stream = await graph.stream(inputs, config);

  for await (const event of stream) {
    const recentMsg = event.messages[event.messages.length - 1];
    console.log(
      `================================ ${recentMsg._getType()} Message (1) =================================`
    );
    console.log(recentMsg.content);
  }

  state = await graph.getState(config);

  RESULT.push(state.next);
  console.log(state.next);

  for await (const event of await graph.stream(
    new Command({
      resume: {
        action: "feedback",
        data: "User requested changes: use <city, country> format for location",
      },
    }),
    config
  )) {
    const recentMsg = event.messages[event.messages.length - 1];
    console.log(
      `================================ ${recentMsg._getType()} Message (1) =================================`
    );
    console.log(recentMsg.content);
  }

  state = await graph.getState(config);

  RESULT.push(state.next);
  console.log(state.next);

  for await (const event of await graph.stream(
    new Command({
      resume: {
        action: "continue",
      },
    }),
    config
  )) {
    const recentMsg = event.messages[event.messages.length - 1];
    console.log(
      `================================ ${recentMsg._getType()} Message (1) =================================`
    );
    console.log(recentMsg.content);
  }

  // prettier-ignore
  fs.writeFile("RESULT-4.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
