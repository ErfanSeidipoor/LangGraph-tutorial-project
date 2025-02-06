import { StateGraph, Annotation } from "@langchain/langgraph";
import { ChatOllama } from "@langchain/ollama";
import * as fs from "fs";

(async () => {
  const llm = new ChatOllama({
    model: "llama3.2",
  });

  const StateAnnotation = Annotation.Root({
    topic: Annotation<string>,
    joke: Annotation<string>,
    improvedJoke: Annotation<string>,
    finalJoke: Annotation<string>,
  });

  async function generateJoke(state: typeof StateAnnotation.State) {
    const message = await llm.invoke(`Write a short joke about ${state.topic}`);
    return { joke: message.content };
  }

  async function checkPunchline(state: typeof StateAnnotation.State) {
    if (state.joke?.includes("?") || state.joke?.includes("!")) {
      return "Pass";
    }
    return "False";
  }

  async function improveJoke(state: typeof StateAnnotation.State) {
    const message = await llm.invoke(
      `Make this joke funnier by adding wordplay: ${state.joke}`
    );
    return { improvedJoke: message.content };
  }

  async function polishJoke(state: typeof StateAnnotation.State) {
    const msg = await llm.invoke(
      `Add a surprising twist to this joke: ${state.improvedJoke}`
    );
    return { finalJoke: msg.content };
  }

  const chain = new StateGraph(StateAnnotation)
    .addNode("generateJoke", generateJoke)
    .addNode("improveJoke", improveJoke)
    .addNode("polishJoke", polishJoke)
    .addEdge("__start__", "generateJoke")
    .addConditionalEdges("generateJoke", checkPunchline, {
      Pass: "improveJoke",
      Fail: "__end__",
    })
    .addEdge("improveJoke", "polishJoke")
    .addEdge("polishJoke", "__end__")
    .compile();

  const state = await chain.invoke({ topic: "cats" });

  // prettier-ignore
  const buffer = (await (await chain.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  fs.writeFileSync("./graph-2-prompt-chaining.png", Buffer.from(await buffer));

  // prettier-ignore
  fs.writeFileSync("result-2-prompt-chaining.json",JSON.stringify({ state }, null, 2),"utf8");
})();
