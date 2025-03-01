import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";

import {
  Annotation,
  END,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";

import * as fs from "fs/promises";

(async () => {
  const RESULT: (object | string)[] = [];

  const llm = new ChatOpenAI({
    model: "gpt-4o",
  });

  /* ----------------------------- EssayGeneration ---------------------------- */

  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `
      You are an essay assistant tasked with writing excellent 5-paragraph essays. Generate the best essay possible for the user's request. If the user provides critique, respond with a revised version of your previous attempts.
      `,
    ],
    new MessagesPlaceholder("messages"),
  ]);

  const essayGenerationChain = prompt.pipe(llm);

  let essay = "";
  const request = new HumanMessage({
    content:
      "Write an essay on why the little prince is relevant in modern childhood",
  });

  // for await (const chunk of await essayGenerationChain.stream({
  //   messages: [request],
  // })) {
  //   console.log(chunk.content);
  //   essay += chunk.content;
  // }

  // console.log(essay);
  // RESULT.push(essay);

  /* --------------------------------- Reflect -------------------------------- */

  const reflectionPrompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `
        You are a teacher grading an essay submission.
        Generate critique and recommendations for the user's submission.
        Provide detailed recommendations, including requests for length, depth, style, etc.
      `,
    ],
    new MessagesPlaceholder("messages"),
  ]);

  const reflect = reflectionPrompt.pipe(llm);

  let reflection = "";

  // for await (const chunk of await reflect.stream({
  //   messages: [request, new HumanMessage({ content: essay })],
  // })) {
  //   console.log(chunk.content);
  //   reflection += chunk.content;
  // }

  // console.log(reflection);
  // RESULT.push(reflection);

  /* ---------------------------------- Graph --------------------------------- */

  const State = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
      reducer: (x, y) => x.concat(y),
    }),
  });

  const generationNode = async (state: typeof State.State) => {
    const { messages } = state;

    return {
      messages: [await essayGenerationChain.invoke({ messages })],
    };
  };

  const reflectionNode = async (state: typeof State.State) => {
    const { messages } = state;

    const clsMap: { [key: string]: new (content: string) => BaseMessage } = {
      ai: HumanMessage,
      human: AIMessage,
    };

    const translated = [
      messages[0],
      ...messages
        .slice(1)
        .map(
          (message) => new clsMap[message.getType()](message.content.toString())
        ),
    ];

    const response = await reflect.invoke({ messages: translated });

    return {
      messages: [new HumanMessage({ content: response.content })],
    };
  };

  const workflow = new StateGraph(State)
    .addNode("generate", generationNode)
    .addNode("reflect", reflectionNode)
    .addEdge(START, "generate");

  const shouldContinue = (state: typeof State.State) => {
    const { messages } = state;
    if (messages.length > 6) {
      // End state after 3 iterations
      return END;
    }
    return "reflect";
  };

  workflow
    .addConditionalEdges("generate", shouldContinue)
    .addEdge("reflect", "generate");

  const app = workflow.compile({ checkpointer: new MemorySaver() });

  const checkpointConfig = { configurable: { thread_id: "my-thread" } };

  const streamFinal = await app.stream(
    {
      messages: [
        new HumanMessage({
          content:
            "Generate an essay on the topicality of The Little Prince and its message in modern life",
        }),
      ],
    },
    checkpointConfig
  );

  for await (const event of streamFinal) {
    for (const [key, _value] of Object.entries(event)) {
      RESULT.push([key, _value]);
      console.log(`Event: ${key}`);
      // Uncomment to see the result of each step.
      // console.log(value.map((msg) => msg.content).join("\n"));
      console.log("\n------\n");
    }
  }

  // prettier-ignore
  fs.writeFile("RESULT.json",JSON.stringify(RESULT, null, 2),"utf8");

  // prettier-ignore
  const buffer2 = (await (await app.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  fs.writeFile("./diagram-2.png", Buffer.from(await buffer2));
})();
