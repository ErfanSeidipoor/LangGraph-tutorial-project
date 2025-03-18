import {
  LangGraphRunnableConfig,
  MessagesAnnotation,
  StateGraph,
} from "@langchain/langgraph";

import * as fs from "fs/promises";

(async () => {
  let RESULT: (object | string)[] = [];

  const myNode = async (
    _state: typeof MessagesAnnotation.State,
    config: LangGraphRunnableConfig
  ) => {
    const chunks = [
      "Four",
      "score",
      "and",
      "seven",
      "years",
      "ago",
      "our",
      "fathers",
      "...",
    ];
    for (const chunk of chunks) {
      config.writer?.(chunk);
    }
    return {
      messages: [
        {
          role: "assistant",
          content: chunks.join(" "),
        },
      ],
    };
  };

  const graph = new StateGraph(MessagesAnnotation)
    .addNode("model", myNode)
    .addEdge("__start__", "model")
    .compile();

  const inputs = [
    {
      role: "user",
      content: "What are you thinking about?",
    },
  ];

  /* --------------------------------- custom --------------------------------- */

  const stream = await graph.stream(
    { messages: inputs },
    { streamMode: "custom" }
  );

  for await (const chunk of stream) {
    console.log(chunk);
    RESULT.push(chunk);
  }

  /* ----------------------------- custom & update ---------------------------- */

  const streamMultiple = await graph.stream(
    { messages: inputs },
    { streamMode: ["custom", "updates"] }
  );

  for await (const chunk of streamMultiple) {
    console.log(chunk);
    RESULT.push(chunk);
  }

  /* --------------------------------- Result --------------------------------- */
  // prettier-ignore
  fs.writeFile("RESULT-custom.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
