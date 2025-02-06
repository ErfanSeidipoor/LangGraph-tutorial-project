import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import { ChatOllama } from "@langchain/ollama";
import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import * as fs from "fs";

(async () => {
  const tools = [new TavilySearchResults({ maxResults: 3 })];
  const toolNode = new ToolNode(tools);

  const model = new ChatOllama({
    model: "llama3.2",
    temperature: 0,
  }).bindTools(tools);

  function shouldContinue({ messages }: typeof MessagesAnnotation.State) {
    const lastMessage = messages[messages.length - 1] as AIMessage;

    if (lastMessage.tool_calls?.length) {
      return "tools";
    }

    return "__end__";
  }

  async function callModel(state: typeof MessagesAnnotation.State) {
    const response = await model.invoke(state.messages);

    return {
      messages: [response],
    };
  }

  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    .addEdge("__start__", "agent")
    .addEdge("tools", "agent")
    .addConditionalEdges("agent", shouldContinue);

  const app = workflow.compile();

  const finalState = await app.invoke({
    messages: [new HumanMessage("what is the weather in sf?")],
  });

  console.log(finalState.messages[finalState.messages.length - 1].content);

  const nextState = await app.invoke({
    // Including the messages from the previous run gives the LLM context.
    // This way it knows we're asking about the weather in NY
    messages: [...finalState.messages, new HumanMessage("what about ny")],
  });
  console.log(nextState.messages[nextState.messages.length - 1].content);

  // prettier-ignore
  const buffer = (await (await app.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  fs.writeFileSync("./graph-customizing-agent.png", Buffer.from(await buffer));

  // prettier-ignore
  fs.writeFileSync("result-customizing-agent.json",JSON.stringify({ finalState, nextState }, null, 2),"utf8");
})();
