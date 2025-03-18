import { tool } from "@langchain/core/tools";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import * as fs from "fs/promises";

(async () => {
  let RESULT: (object | string)[] = [];

  /* ------------------------------- GraphState ------------------------------- */

  const StateAnnotation = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
      reducer: (x, y) => x.concat(y),
    }),
  });

  /* ---------------------------------- tool ---------------------------------- */

  const searchTool = tool(
    async ({ query: _query }: { query: string }) => {
      // This is a placeholder for the actual implementation
      return "Cold, with a low of 3℃";
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
  const model = new ChatOpenAI({ model: "gpt-4o" });
  const boundModel = model.bindTools(tools);

  /* ---------------------------------- graph --------------------------------- */

  const routeMessage = (state: typeof StateAnnotation.State) => {
    const { messages } = state;
    const lastMessage = messages[messages.length - 1] as AIMessage;
    if (!lastMessage?.tool_calls?.length) {
      return END;
    }
    return "tools";
  };

  const callModel = async (state: typeof StateAnnotation.State) => {
    const { messages } = state;
    const responseMessage = await boundModel.invoke(messages);
    return { messages: [responseMessage] };
  };

  const workflow = new StateGraph(StateAnnotation)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", routeMessage)
    .addEdge("tools", "agent");

  const graph = workflow.compile();

  /* --------------------------------- stream --------------------------------- */
  let inputs = {
    messages: [new HumanMessage({ content: "what's the weather in sf" })],
  };

  for await (const chunk of await graph.stream(inputs, {
    streamMode: "updates",
  })) {
    for (const [node, values] of Object.entries(chunk)) {
      console.log(`Receiving update from node: ${node}`);
      console.log(values);
      console.log("\n====\n");
      RESULT.push({ [node]: values });
    }
  }

  /* --------------------------------- Result --------------------------------- */
  // prettier-ignore
  fs.writeFile("RESULT.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
