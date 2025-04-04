import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  isAIMessage,
} from "@langchain/core/messages";

import { RunnableConfig } from "@langchain/core/runnables";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import * as fs from "fs/promises";
import { z } from "zod";

(async () => {
  let RESULT: (object | string)[] = [];

  const SearchTool = z.object({
    query: z.string().describe("query to look up online"),
    return_direct: z
      .boolean()
      .describe(
        "Whether or not the result of this should be returned directly to the user without you seeing what it is"
      )
      .default(false),
  });

  const searchTool = new DynamicStructuredTool({
    name: "search",
    description: "Call to surf the web.",
    schema: SearchTool,
    func: async ({}: { query: string }) => {
      return "It's sunny in San Francisco, but you better look out if you're a Gemini 😈.";
    },
  });

  const tools = [searchTool];
  const toolNode = new ToolNode(tools);

  const model = new ChatOpenAI({
    temperature: 0,
    model: "gpt-3.5-turbo",
  });
  const boundModel = model.bindTools(tools);

  const AgentState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
      reducer: (x, y) => x.concat(y),
    }),
  });

  const shouldContinue = (state: typeof AgentState.State) => {
    const { messages } = state;
    const lastMessage = messages[messages.length - 1] as AIMessage;
    if (!lastMessage?.tool_calls?.length) {
      return END;
    } else {
      const args = lastMessage.tool_calls[0].args;
      if (args?.return_direct) {
        return "final";
      } else {
        return "tools";
      }
    }
  };

  const callModel = async (
    state: typeof AgentState.State,
    config?: RunnableConfig
  ) => {
    const messages = state.messages;
    const response = await boundModel.invoke(messages, config);
    return { messages: [response] };
  };

  const workflow = new StateGraph(AgentState)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    .addNode("final", toolNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", shouldContinue)
    .addEdge("tools", "agent")
    .addEdge("final", END);

  const app = workflow.compile();

  // prettier-ignore
  const buffer = (await (await app.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./diagram.png", Buffer.from(await buffer));

  const prettyPrint = (message: BaseMessage) => {
    let txt = `[${message._getType()}]: ${message.content}`;
    if (
      (isAIMessage(message) && (message as AIMessage)?.tool_calls?.length) ||
      0 > 0
    ) {
      const tool_calls = (message as AIMessage)?.tool_calls
        ?.map((tc) => `- ${tc.name}(${JSON.stringify(tc.args)})`)
        .join("\n");
      txt += ` \nTools: \n${tool_calls}`;
    }
    console.log(txt);
  };

  const inputs = { messages: [new HumanMessage("what is the weather in sf")] };
  for await (const output of await app.stream(inputs, {
    streamMode: "values",
  })) {
    const lastMessage = output.messages[output.messages.length - 1];
    prettyPrint(lastMessage);
    RESULT.push(lastMessage);
    console.log("-----\n");
  }

  const inputs2 = {
    messages: [
      new HumanMessage(
        "what is the weather in sf? return this result directly by setting return_direct = True"
      ),
    ],
  };
  for await (const output of await app.stream(inputs2, {
    streamMode: "values",
  })) {
    const lastMessage = output.messages[output.messages.length - 1];
    prettyPrint(lastMessage);
    RESULT.push(lastMessage);
    console.log("-----\n");
  }

  // prettier-ignore
  fs.writeFile("RESULT.json", JSON.stringify(RESULT, null, 2), "utf8");
})();
