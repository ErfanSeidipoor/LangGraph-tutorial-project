import { StateGraph, Annotation } from "@langchain/langgraph";
import { z } from "zod";
import { ChatOllama } from "@langchain/ollama";
import * as fs from "fs";

(async () => {
  const llm = new ChatOllama({
    model: "llama3.2",
  });

  const StateAnnotation = Annotation.Root({
    input: Annotation<string>,
    decision: Annotation<string>,
    output: Annotation<string>,
  });

  async function storyWriterNode(state: typeof StateAnnotation.State) {
    const result = await llm.invoke([
      {
        role: "system",
        content: "You are an expert storyTeller",
      },
      {
        role: "user",
        content: state.input,
      },
    ]);

    return { output: result.content };
  }

  async function jokeWriterNode(state: typeof StateAnnotation.State) {
    const result = await llm.invoke([
      {
        role: "system",
        content: "You are an expert comedian.",
      },
      {
        role: "user",
        content: state.input,
      },
    ]);
    return { output: result.content };
  }

  async function poemWriterNode(state: typeof StateAnnotation.State) {
    const result = await llm.invoke([
      {
        role: "system",
        content: "You are an expert poet.",
      },
      {
        role: "user",
        content: state.input,
      },
    ]);
    return { poem: result.content };
  }

  async function routerNode(state: typeof StateAnnotation.State) {
    const routeSchema = z.object({
      step: z
        .enum(["poem", "story", "joke"])
        .describe("the next step in the routing process"),
    });

    const { step } = await llm.withStructuredOutput(routeSchema).invoke([
      {
        role: "system",
        content:
          "Route the input to story, joke, or poem based on the user's request.",
      },
      {
        role: "user",
        content: state.input,
      },
    ]);

    return { decision: step };
  }

  function routeDecision(state: typeof StateAnnotation.State) {
    if (state.decision === "poem") {
      return "poem";
    } else if (state.decision === "story") {
      return "story";
    } else if (state.decision === "joke") {
      return "joke";
    }

    return "poem";
  }

  const chain = new StateGraph(StateAnnotation)
    .addNode("jokeWriterNode", jokeWriterNode)
    .addNode("storyWriterNode", storyWriterNode)
    .addNode("poemWriterNode", poemWriterNode)
    .addNode("routerNode", routerNode)
    .addEdge("__start__", "routerNode")
    .addConditionalEdges("routerNode", routeDecision, {
      poem: "poemWriterNode",
      story: "storyWriterNode",
      joke: "jokeWriterNode",
    })
    .addEdge("jokeWriterNode", "__end__")
    .addEdge("storyWriterNode", "__end__")
    .addEdge("poemWriterNode", "__end__")
    .compile();

  const state = await chain.invoke({ input: "Write me a joke about cats" });

  // prettier-ignore
  const buffer = (await (await chain.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  fs.writeFileSync("./graph-5-routing.png", Buffer.from(await buffer));

  // prettier-ignore
  fs.writeFileSync("result-5-routing.json",JSON.stringify({ state }, null, 2),"utf8");
})();
