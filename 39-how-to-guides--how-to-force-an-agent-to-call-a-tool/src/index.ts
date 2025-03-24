import { tool } from "@langchain/core/tools";
import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { z } from "zod";
import { concat } from "@langchain/core/utils/stream";
import * as fs from "fs/promises";
import { RunnableConfig } from "@langchain/core/runnables";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import { END, START, StateGraph } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";

(async () => {
  let RESULT: (object | string)[] = [];

  /* ---------------------------------- tools --------------------------------- */

  const searchTool = tool(
    async ({}: { query: string }) => {
      return "Cold, with a low of 13 ℃";
    },
    {
      name: "search",
      description:
        "Use to surf the web, fetch current information, check the weather, and retrieve other information.",
      schema: z.object({
        query: z.string().describe("The query to use in your search."),
      }),
    }
  );

  await searchTool.invoke({ query: "What's the weather like?" });

  const tools = [searchTool];

  const toolNode = new ToolNode(tools);

  /* ---------------------------------- model --------------------------------- */
  const model = new ChatOpenAI({
    temperature: 0,
    model: "gpt-4o",
  });
  const boundModel = model.bindTools(tools);

  /* ---------------------------------- graph --------------------------------- */

  const AgentState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
      reducer: (x, y) => x.concat(y),
    }),
  });

  /* ------------------------------ node and edge ----------------------------- */

  const shouldContinue = (state: typeof AgentState.State) => {
    const { messages } = state;
    const lastMessage = messages[messages.length - 1] as AIMessage;
    if (!lastMessage.tool_calls || lastMessage.tool_calls.length === 0) {
      return "end";
    }
    return "continue";
  };

  const firstModel = async (state: typeof AgentState.State) => {
    const humanInput = state.messages[state.messages.length - 1].content || "";
    return {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "search",
              args: {
                query: humanInput,
              },
              id: "tool_abcd123",
            },
          ],
        }),
      ],
    };
  };

  const callModel = async (
    state: typeof AgentState.State,
    config?: RunnableConfig
  ) => {
    const { messages } = state;
    let response: AIMessageChunk | undefined;
    for await (const message of await boundModel.stream(messages, config)) {
      if (!response) {
        response = message;
      } else {
        response = concat(response, message);
      }
    }
    // We return an object, because this will get added to the existing list
    return {
      messages: response ? [response as AIMessage] : [],
    };
  };

  /* ---------------------------------- graph --------------------------------- */

  const workflow = new StateGraph(AgentState)
    .addNode("first_agent", firstModel)
    .addNode("agent", callModel)
    .addNode("action", toolNode)
    .addEdge(START, "first_agent")
    .addConditionalEdges("agent", shouldContinue, {
      continue: "action",
      end: END,
    })
    .addEdge("action", "agent")
    .addEdge("first_agent", "action");

  const app = workflow.compile();

  /* --------------------------------- stream --------------------------------- */
  const inputs = {
    messages: [new HumanMessage("what is the weather in sf")],
  };

  for await (const output of await app.stream(inputs)) {
    console.log(output);
    console.log("-----\n");
    RESULT.push(output);
  }

  /* --------------------------------- Result --------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
