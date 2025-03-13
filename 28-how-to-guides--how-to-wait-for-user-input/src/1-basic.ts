import {
  Annotation,
  Command,
  END,
  interrupt,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";
import * as fs from "fs/promises";

(async () => {
  const RESULT: (object | string)[] = [];

  /* --------------------------------- memory --------------------------------- */
  // Set up memory
  const memory = new MemorySaver();

  /* ---------------------------------- state --------------------------------- */
  const StateAnnotation = Annotation.Root({
    input: Annotation<string>,
    userFeedback: Annotation<string>,
  });

  const step1 = (_state: typeof StateAnnotation.State) => {
    console.log("---Step 1---");
    return {};
  };

  const humanFeedback = (_state: typeof StateAnnotation.State) => {
    console.log("--- humanFeedback ---");
    const feedback: string = interrupt("Please provide feedback");
    return {
      userFeedback: feedback,
    };
  };

  const step3 = (_state: typeof StateAnnotation.State) => {
    console.log("---Step 3---");
    return {};
  };

  /* ---------------------------------- Graph --------------------------------- */

  const builder = new StateGraph(StateAnnotation)
    .addNode("step1", step1)
    .addNode("humanFeedback", humanFeedback)
    .addNode("step3", step3)
    .addEdge(START, "step1")
    .addEdge("step1", "humanFeedback")
    .addEdge("humanFeedback", "step3")
    .addEdge("step3", END);

  const graph = builder.compile({
    checkpointer: memory,
  });

  // prettier-ignore
  const buffer = (await (await graph.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./diagram-basic.png", Buffer.from(await buffer));

  /* --------------------------------- Result --------------------------------- */

  /* --------------------------------- invoke --------------------------------- */

  const config = { configurable: { thread_id: "1" } };
  const initialInput = { input: "hello world" };

  for await (const event of await graph.stream(initialInput, config)) {
    console.log(event);
    RESULT.push(event);
  }

  /* --------------------------------- command -------------------------------- */

  for await (const event of await graph.stream(
    new Command({ resume: "go to step 3! " }),
    config
  )) {
    console.log(event);
    RESULT.push(event);
    console.log("\n====\n");
  }

  /* ---------------------------------- state --------------------------------- */

  const state = (await graph.getState(config)).values;
  console.log(state);
  RESULT.push(state);

  /* --------------------------------- result --------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT-basic.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
