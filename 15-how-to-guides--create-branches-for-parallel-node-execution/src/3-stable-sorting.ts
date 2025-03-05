import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import * as fs from "fs/promises";

(async () => {
  const RESULT: (object | string)[] = [];

  type ScoredValue = {
    value: string;
    score: number;
  };

  const StableSortingAnnotation = Annotation.Root({
    aggregate: Annotation<string[]>({
      reducer: (x, y) => x.concat(y),
    }),
    which: Annotation<string>({
      reducer: (x: string, y: string) => y ?? x,
    }),
    fanoutValues: Annotation<ScoredValue[]>({
      reducer: (left?: ScoredValue[], right?: ScoredValue[]) => {
        if (!left) {
          left = [];
        }
        if (!right || right?.length === 0) {
          return [];
        }
        return left.concat(right);
      },
    }),
  });

  class ParallelReturnNodeValue {
    private _value: string;
    private _score: number;

    constructor(nodeSecret: string, score: number) {
      this._value = nodeSecret;
      this._score = score;
    }

    public call(state: typeof StableSortingAnnotation.State) {
      console.log(`Adding ${this._value} to ${state.aggregate}`);
      return { fanoutValues: [{ value: this._value, score: this._score }] };
    }
  }

  const nodeA = (state: typeof StableSortingAnnotation.State) => {
    console.log(`Adding I'm A to ${state.aggregate}`);
    return { aggregate: ["I'm A"] };
  };

  const nodeB = new ParallelReturnNodeValue("I'm B", 0.1);
  const nodeC = new ParallelReturnNodeValue("I'm C", 0.9);
  const nodeD = new ParallelReturnNodeValue("I'm D", 0.3);

  const aggregateFanouts = (state: typeof StableSortingAnnotation.State) => {
    // Sort by score (reversed)
    state.fanoutValues.sort((a, b) => b.score - a.score);
    return {
      aggregate: state.fanoutValues.map((v) => v.value).concat(["I'm E"]),
      fanoutValues: [],
    };
  };

  // Define the route function
  function routeBCOrCD(state: typeof StableSortingAnnotation.State): string[] {
    if (state.which === "cd") {
      return ["c", "d"];
    }
    return ["b", "c"];
  }

  const builder3 = new StateGraph(StableSortingAnnotation)
    .addNode("a", nodeA)
    .addEdge(START, "a")
    .addNode("b", nodeB.call.bind(nodeB))
    .addNode("c", nodeC.call.bind(nodeC))
    .addNode("d", nodeD.call.bind(nodeD))
    .addNode("e", aggregateFanouts)
    .addConditionalEdges("a", routeBCOrCD, ["b", "c", "d"])
    .addEdge("b", "e")
    .addEdge("c", "e")
    .addEdge("d", "e")
    .addEdge("e", END);

  const graph3 = builder3.compile();

  const buffer = (
    await (await graph3.getGraphAsync()).drawMermaidPng({})
  ).arrayBuffer();
  fs.writeFile("./diagram-3.png", Buffer.from(await buffer));

  // Invoke the graph
  let result = await graph3.invoke({ aggregate: [], which: "bc" });
  console.log("Result: ", result);
})();
