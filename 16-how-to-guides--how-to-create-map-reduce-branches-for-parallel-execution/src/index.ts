import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, END, START, Annotation, Send } from "@langchain/langgraph";
import * as fs from "fs/promises";

(async () => {
  const RESULT: (object | string)[] = [];

  const subjectsPrompt =
    "Provide a list of examples related to {topic}. Aim for a comprehensive list, but the number of examples can vary based on the depth and breadth of the topic.";
  const jokePrompt = "Generate a joke about {subject}";
  const bestJokePrompt =
    "Blew are a bunch of jokes about {topic}. select the best one! Return the ID (index) of the best one.  \n {jokes}";

  const Subjects = z.object({
    subjects: z.array(z.string()),
  });

  const Joke = z.object({
    joke: z.string(),
  });

  const BestJoke = z.object({
    id: z.string(),
  });

  const model = new ChatOpenAI({ model: "gpt-4o", temperature: 0.5 });

  /* ---------------------------------- State --------------------------------- */

  const OverallState = Annotation.Root({
    topic: Annotation<string>,
    subjects: Annotation<string[]>,
    jokes: Annotation<string[]>({
      reducer: (state, update) => state.concat(update),
    }),
    bestSelectedJoke: Annotation<string>,
  });

  /* ---------------------------- generateSubjects ---------------------------- */

  const generateSubjects = async (
    state: typeof OverallState.State
  ): Promise<Partial<typeof OverallState.State>> => {
    const prompt = subjectsPrompt.replace("{topic}", state.topic);
    const response = await model
      .withStructuredOutput(Subjects, { name: "subjects" })
      .invoke(prompt);

    RESULT.push({
      generateSubjects: {
        prompt,
        topic: state.topic,
        subjects: response.subjects,
      },
    });
    return { subjects: response.subjects };
  };

  /* ------------------------------ generateJoke ------------------------------ */
  interface JokeState {
    subject: string;
  }

  const generateJoke = async (
    state: JokeState
  ): Promise<{ jokes: string[] }> => {
    const prompt = jokePrompt.replace("{subject}", state.subject);
    const response = await model
      .withStructuredOutput(Joke, { name: "joke" })
      .invoke(prompt);

    RESULT.push({ jokes: [response.joke] });
    return { jokes: [response.joke] };
  };

  /* ----------------------------- continueToJokes ---------------------------- */

  const continueToJokes = (state: typeof OverallState.State) => {
    return state.subjects.map(
      (subject) => new Send("generateJoke", { subject })
    );
  };

  /* -------------------------------- bestJoke -------------------------------- */
  const bestJoke = async (
    state: typeof OverallState.State
  ): Promise<Partial<typeof OverallState.State>> => {
    const jokes = state.jokes.join("\n");
    const prompt = bestJokePrompt
      .replace("{jokes}", jokes)
      .replace("{topic}", state.topic);

    const response = await model
      .withStructuredOutput(BestJoke, {
        name: "best_joke",
      })
      .invoke(prompt);

    RESULT.push({
      prompt,
      "state.jokes": state.jokes,
      id: response.id,
      bestSelectedJoke: state.jokes[Number(response.id)],
    });
    return { bestSelectedJoke: state.jokes[Number(response.id)] };
  };

  /* ---------------------------------- Graph --------------------------------- */
  const graph = new StateGraph(OverallState)
    .addNode("generateSubjects", generateSubjects)
    .addNode("generateJoke", generateJoke)
    .addNode("bestJoke", bestJoke)
    .addEdge(START, "generateSubjects")
    .addConditionalEdges("generateSubjects", continueToJokes, ["generateJoke"])
    .addEdge("generateJoke", "bestJoke")
    .addEdge("bestJoke", END);

  const app = graph.compile();
  /* --------------------------------- Invoke --------------------------------- */

  // Invoke the graph
  const buffer = (
    await (await app.getGraphAsync()).drawMermaidPng({})
  ).arrayBuffer();
  fs.writeFile("./diagram-1.png", Buffer.from(await buffer));

  for await (const s of await app.stream({ topic: "games" })) {
    console.log(s);
  }

  // prettier-ignore
  fs.writeFile("RESULT.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
