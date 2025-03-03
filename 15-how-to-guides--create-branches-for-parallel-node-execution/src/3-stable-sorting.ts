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

  // const buffer = (
  //   await (await graph.getGraphAsync()).drawMermaidPng({})
  // ).arrayBuffer();
  // fs.writeFile("./diagram-2.png", Buffer.from(await buffer));

  /* --------------------------------- Invoke --------------------------------- */

  // let result = await graph.invoke({ aggregate: [], which: "bc" });
  // console.log("Result 1: ", result);

  /* --------------------------------- output --------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT_3.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
