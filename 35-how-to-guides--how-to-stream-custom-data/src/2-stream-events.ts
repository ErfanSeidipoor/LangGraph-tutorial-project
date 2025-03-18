import {
  LangGraphRunnableConfig,
  MessagesAnnotation,
  StateGraph,
} from "@langchain/langgraph";
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";

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
      await dispatchCustomEvent("my_custom_event", { chunk });
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

  const stream = await graph.streamEvents(
    { messages: inputs },
    { version: "v2" }
  );

  for await (const { event, name, data } of stream) {
    console.log({ name, data, event });
    RESULT.push({ name, data, event });
  }

  /* --------------------------------- Result --------------------------------- */
  // prettier-ignore
  fs.writeFile("RESULT-events.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
