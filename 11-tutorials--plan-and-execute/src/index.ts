import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { Runnable, RunnableConfig } from "@langchain/core/runnables";
import {
  DynamicStructuredTool,
  StructuredToolInterface,
  tool,
} from "@langchain/core/tools";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import { JsonOutputToolsParser } from "@langchain/core/output_parsers/openai_tools";
import { zodToJsonSchema } from "zod-to-json-schema";

import {
  Annotation,
  END,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { createCanvas } from "canvas";
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import { ChatOpenAI } from "@langchain/openai";
import { RunnableLambda } from "@langchain/core/runnables";

import * as d3 from "d3";
import * as fs from "fs/promises";
import { z } from "zod";
import * as path from "path";

(async () => {
  const RESULT: (object | string)[] = [];

  /* ---------------------------------- State --------------------------------- */

  const PlanAndExecuteState = Annotation.Root({
    input: Annotation<string>({
      reducer: (x, y) => y ?? x ?? "",
    }),
    plan: Annotation<string>({
      reducer: (x, y) => y ?? x ?? "",
    }),
    pastStep: Annotation<[string, string][]>({
      reducer: (x, y) => x.concat(y),
    }),
    response: Annotation<string>({
      reducer: (x, y) => y ?? x,
    }),
  });

  /* ---------------------------------- Tools --------------------------------- */

  const tools = [new TavilySearchResults({ maxResults: 3 })];

  /* ----------------------------- Execution Agent ---------------------------- */

  const agentExecutor = createReactAgent({
    llm: new ChatGoogleGenerativeAI({ model: "gemini-1.5-pro" }),
    tools,
  });

  const response1 = await agentExecutor.invoke({
    messages: [new HumanMessage("who is the winner of the us open ?")],
  });

  RESULT.push(response1);

  /* ------------------------------ Planning Step ----------------------------- */

  const plannerPrompt = ChatPromptTemplate.fromTemplate(
    `
    For the given objective, come up with simple step by step plan.
    This plan should involve individual tasks, that if executed correctly will yield the correct answer. Do not add this result to the final step should be the final answer. Make sure that each step has tge information needed - do not skip steps.

    objective: {objective}
    `
  );

  const llm = new ChatOllama({
    model: "llama3.2",
    temperature: 0,
  });

  const model = llm.withStructuredOutput(
    z.object({
      steps: z
        .array(z.string())
        .describe("different steps to follow, should be in sorted order"),
    })
  );

  // const model = new ChatOllama({
  //   model: "llama3.2",
  // }).withStructuredOutput({
  //   name: "plan",
  //   description: "this tool is used to plan the steps to follow",
  //   parameters: zodToJsonSchema(
  //     z.object({
  //       steps: z
  //         .array(z.string())
  //         .describe("different steps to follow, should be in sorted order"),
  //     })
  //   ),
  // });

  // const planner = plannerPrompt.pipe(model);

  // const response2 = await planner.invoke({
  //   objective: "what is the hometown of the current Australia open winner?",
  // });

  const planner = plannerPrompt.pipe(model);
  const response2 = await planner.invoke({
    objective: "what is the hometown of the current Australia open winner?",
  });

  RESULT.push(response2);

  /* --------------------------------- Result --------------------------------- */
  // prettier-ignore
  fs.writeFile("RESULT.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
