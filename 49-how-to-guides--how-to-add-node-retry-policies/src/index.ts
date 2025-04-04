import { AIMessage } from "@langchain/core/messages";
import Database from "better-sqlite3";

import {
  END,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import * as fs from "fs/promises";

(async () => {
  let RESULT: (object | string)[] = [];

  const db: typeof Database.prototype = new Database(":memory:");

  const model = new ChatOpenAI({ model: "gpt-4o" });

  const callModel = async (state: typeof MessagesAnnotation.State) => {
    const response = await model.invoke(state.messages);
    return { messages: [response] };
  };

  const queryDatabase = async (state: typeof MessagesAnnotation.State) => {
    const queryResult: string = JSON.stringify(
      db.prepare("SELECT * FROM Artist LIMIT 10;").all()
    );

    return { messages: [new AIMessage({ content: queryResult })] };
  };

  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("call_model", callModel, { retryPolicy: { maxAttempts: 5 } })
    .addNode("query_database", queryDatabase, {
      retryPolicy: {
        retryOn: (e: any): boolean => {
          if (e instanceof Database.SqliteError) {
            return e.code === "SQLITE_BUSY";
          }
          return false;
        },
      },
    })
    .addEdge(START, "call_model")
    .addEdge("call_model", "query_database")
    .addEdge("query_database", END);

  const graph = workflow.compile();

  // prettier-ignore
  const buffer = (await (await graph.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./diagram.png", Buffer.from(await buffer));

  // prettier-ignore
  fs.writeFile("RESULT.json", JSON.stringify(RESULT, null, 2), "utf8");
})();
