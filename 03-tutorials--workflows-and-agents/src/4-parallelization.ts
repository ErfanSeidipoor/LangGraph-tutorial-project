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
    story: Annotation<string>,
    poem: Annotation<string>,
    combinedOutput: Annotation<string>,
  });

  async function jokeWriter(state: typeof StateAnnotation.State) {
    const message = await llm.invoke(`Write a joke about ${state.topic}`);
    return { joke: message.content };
  }

  async function storyWriter(state: typeof StateAnnotation.State) {
    const message = await llm.invoke(`Write a story about ${state.topic}`);
    return { story: message.content };
  }

  async function poemWriter(state: typeof StateAnnotation.State) {
    const message = await llm.invoke(`Write a poem about ${state.topic}`);
    return { poem: message.content };
  }

  async function aggregator(state: typeof StateAnnotation.State) {
    const combined =
      `Here's a story, joke, and poem about ${state.topic}!\n\n` +
      `STORY:\n${state.story}\n\n` +
      `JOKE:\n${state.joke}\n\n` +
      `POEM:\n${state.poem}`;
    return { combinedOutput: combined };
  }

  const chain = new StateGraph(StateAnnotation)
    .addNode("jokeWriter", jokeWriter)
    .addNode("storyWriter", storyWriter)
    .addNode("poemWriter", poemWriter)
    .addNode("aggregator", aggregator)
    .addEdge("__start__", "jokeWriter")
    .addEdge("__start__", "storyWriter")
    .addEdge("__start__", "poemWriter")
    .addEdge("jokeWriter", "aggregator")
    .addEdge("storyWriter", "aggregator")
    .addEdge("poemWriter", "aggregator")
    .addEdge("aggregator", "__end__")
    .compile();

  const state = await chain.invoke({ topic: "cats" });

  // prettier-ignore
  const buffer = (await (await chain.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  fs.writeFileSync("./graph-4-parallelization.png", Buffer.from(await buffer));

  // prettier-ignore
  fs.writeFileSync("result-4-parallelization.json",JSON.stringify({ state }, null, 2),"utf8");
})();
