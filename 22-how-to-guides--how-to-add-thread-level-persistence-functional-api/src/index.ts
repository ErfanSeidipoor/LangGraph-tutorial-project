import { BaseMessage, BaseMessageLike } from "@langchain/core/messages";
import {
  addMessages,
  entrypoint,
  getPreviousState,
  MemorySaver,
  task,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import * as fs from "fs/promises";

(async () => {
  const RESULT: (object | string)[] = [];

  /* ---------------------------------- Model --------------------------------- */

  const model = new ChatOpenAI({ model: "gpt-4o" });

  /* ---------------------------------- node ---------------------------------- */

  const callModel = task("callModel", async (messages: BaseMessageLike[]) => {
    const response = model.invoke(messages);
    return response;
  });

  const checkpointer = new MemorySaver();

  /* -------------------------------- workflow -------------------------------- */

  const workflow = entrypoint(
    {
      name: "workflow",
      checkpointer,
    },
    async (inputs: BaseMessageLike[]) => {
      const previous = getPreviousState<BaseMessage>() ?? [];
      const messages = addMessages(previous, inputs);
      const response = await callModel(messages);
      return entrypoint.final({
        value: response,
        save: addMessages(messages, response),
      });
    }
  );

  /* ------------------------------ Frist Stream ------------------------------ */
  const config = {
    configurable: { thread_id: "1" },
    streamMode: "values" as const,
  };
  const inputMessage = { role: "user", content: "hi! I'm bob" };

  const stream = await workflow.stream([inputMessage], config);

  for await (const chunk of stream) {
    console.log("=".repeat(30), `${chunk.getType()} message`, "=".repeat(30));
    RESULT.push(`${chunk.getType()} message`);
    console.log(chunk.content);
    RESULT.push(chunk.content);
  }

  const followupStream = await workflow.stream(
    [{ role: "user", content: "what's my name?" }],
    config
  );

  for await (const chunk of followupStream) {
    console.log("=".repeat(30), `${chunk.getType()} message`, "=".repeat(30));
    RESULT.push(`${chunk.getType()} message`);
    console.log(chunk.content);
    RESULT.push(chunk.content);
  }

  /* ------------------------------ Second Stream ----------------------------- */
  const newStream = await workflow.stream(
    [{ role: "user", content: "what's my name?" }],
    {
      configurable: {
        thread_id: "2",
      },
      streamMode: "values",
    }
  );

  for await (const chunk of newStream) {
    console.log("=".repeat(30), `${chunk.getType()} message`, "=".repeat(30));
    RESULT.push(`${chunk.getType()} message`);
    console.log(chunk.content);
    RESULT.push(chunk.content);
  }

  /* --------------------------------- Result --------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
