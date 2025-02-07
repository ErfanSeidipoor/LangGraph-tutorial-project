import { StateGraph, Annotation, Send } from "@langchain/langgraph";
import { z } from "zod";
import { ChatOllama } from "@langchain/ollama";
import * as fs from "fs";

(async () => {
  const llm = new ChatOllama({
    model: "llama3.2",
  });
  const StateAnnotation = Annotation.Root({
    joke: Annotation<string>,
    topic: Annotation<string>,
    feedback: Annotation<string>,
    funnyOrNot: Annotation<"funny" | "not funny">,
  });

  async function jokeWriterNode(state: typeof StateAnnotation.State) {
    let msg;
    if (state.feedback) {
      msg = await llm.invoke(
        `Write a joke about ${state.topic} but take into account the feedback: ${state.feedback}`
      );
    } else {
      msg = await llm.invoke(`Write a joke about ${state.topic}`);
    }

    return {
      joke: msg.content as string,
    };
  }

  async function jokerEvaluatorNode(state: typeof StateAnnotation.State) {
    const feedBackSchema = z.object({
      grade: z
        .enum(["funny", "not funny"])
        .describe("Describe if the joke is funny of not"),
      feedback: z
        .string()
        .describe(
          "If the joke is not funny, provide feedback on how to improve it."
        ),
    });

    const evaluator = llm.withStructuredOutput(feedBackSchema);

    const result = await evaluator.invoke(state.joke);

    return { feedback: result.feedback, funnyOrNot: result.grade };
  }

  function evaluatorConditionEdge(state: typeof StateAnnotation.State) {
    console.log("evaluatorConditionEdge > ", state);

    if (state.funnyOrNot === "funny") {
      return "Accepted";
    }
    return "Rejected";
  }

  const optimizerWorkflow = new StateGraph(StateAnnotation)
    .addNode("jokeWriterNode", jokeWriterNode)
    .addNode("jokerEvaluatorNode", jokerEvaluatorNode)
    .addEdge("__start__", "jokeWriterNode")
    .addEdge("jokeWriterNode", "jokerEvaluatorNode")
    .addConditionalEdges("jokerEvaluatorNode", evaluatorConditionEdge, {
      Accepted: "__end__",
      Rejected: "jokeWriterNode",
    })
    .compile();

  const state = await optimizerWorkflow.invoke({ topic: "Cats" });

  // prettier-ignore
  const buffer = (await (await optimizerWorkflow.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  fs.writeFileSync(
    "./graph-7-evaluator-optimizer.png",
    Buffer.from(await buffer)
  );

  // prettier-ignore
  fs.writeFileSync("result-7-evaluator-optimizer.json",JSON.stringify({ state }, null, 2),"utf8");
})();
