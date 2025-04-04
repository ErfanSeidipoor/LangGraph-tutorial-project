import { ChatAnthropic } from "@langchain/anthropic";
import { BaseMessage, HumanMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableConfig } from "@langchain/core/runnables";
import {
  Annotation,
  END,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import * as fs from "fs/promises";

(async () => {
  let RESULT: (object | string)[] = [];

  const model = new ChatOpenAI({
    model: "gpt-4o",
    temperature: 0.1,
  });

  const AgentState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
      reducer: (x, y) => x.concat(y),
    }),
    userInfo: Annotation<string | undefined>({
      reducer: (x, y) => {
        return y ? y : x ? x : "N/A";
      },
      default: () => "N/A",
    }),
  });

  const promptTemplate = ChatPromptTemplate.fromMessages([
    ["system", "You are a helpful assistant.\n\n## User Info:\n{userInfo}"],
    ["placeholder", "{messages}"],
  ]);

  const callModel = async (
    state: typeof AgentState.State,
    config?: RunnableConfig
  ) => {
    const { messages, userInfo } = state;
    const modelName = config?.configurable?.model;
    const model =
      modelName === "claude"
        ? new ChatAnthropic({ model: "claude-3-haiku-20240307" })
        : new ChatOpenAI({ model: "gpt-4o" });
    const chain = promptTemplate.pipe(model);
    const response = await chain.invoke(
      {
        messages,
        userInfo,
      },
      config
    );
    return { messages: [response] };
  };

  const fetchUserInformation = async (
    _: typeof AgentState.State,
    config?: RunnableConfig
  ) => {
    const userDB = {
      user1: {
        name: "John Doe",
        email: "jod@langchain.ai",
        phone: "+1234567890",
      },
      user2: {
        name: "Jane Doe",
        email: "jad@langchain.ai",
        phone: "+0987654321",
      },
    };
    const userId = config?.configurable?.user;
    if (userId) {
      const user = userDB[userId as keyof typeof userDB];
      if (user) {
        return {
          userInfo: `Name: ${user.name}\nEmail: ${user.email}\nPhone: ${user.phone}`,
        };
      }
    }
    return { userInfo: "N/A" };
  };

  const workflow = new StateGraph(AgentState)
    .addNode("fetchUserInfo", fetchUserInformation)
    .addNode("agent", callModel)
    .addEdge(START, "fetchUserInfo")
    .addEdge("fetchUserInfo", "agent")
    .addEdge("agent", END);

  const graph = workflow.compile();

  // prettier-ignore
  const buffer = (await (await graph.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./diagram.png", Buffer.from(await buffer));

  /* ---------------------------- Call with config ---------------------------- */

  const config = {
    configurable: {
      model: "openai",
      user: "user1",
    },
  };
  const inputs = {
    messages: [new HumanMessage("Could you remind me of my email??")],
  };

  for await (const { messages } of await graph.stream(inputs, {
    ...config,
    streamMode: "values",
  })) {
    let msg = messages[messages?.length - 1];
    if (msg?.content) {
      console.log(msg.content);
      RESULT.push(msg.content);
    } else if (msg?.tool_calls?.length > 0) {
      console.log(msg.tool_calls);
      RESULT.push(msg.tool_calls);
    } else {
      console.log(msg);
      RESULT.push(msg);
    }
    console.log("-----\n");
  }

  const config2 = {
    configurable: {
      model: "openai",
      user: "user2",
    },
  };
  const inputs2 = {
    messages: [new HumanMessage("Could you remind me of my email??")],
  };
  for await (const { messages } of await graph.stream(inputs2, {
    ...config2,
    streamMode: "values",
  })) {
    let msg = messages[messages?.length - 1];
    if (msg?.content) {
      console.log(msg.content);
      RESULT.push(msg.content);
    } else if (msg?.tool_calls?.length > 0) {
      console.log(msg.tool_calls);
      RESULT.push(msg.tool_calls);
    } else {
      console.log(msg);
      RESULT.push(msg);
    }
    console.log("-----\n");
  }

  /* ------------------------------ Config schema ----------------------------- */

  const ConfigurableAnnotation = Annotation.Root({
    expectedField: Annotation<string>,
  });

  const printNode = async (
    state: typeof MessagesAnnotation.State,
    config: RunnableConfig<typeof ConfigurableAnnotation.State>
  ) => {
    console.log("Expected", config.configurable?.expectedField);
    // @ts-expect-error This type will be present even though is not in the typing
    console.log("Unexpected", config.configurable?.unexpectedField);
    return {};
  };

  const graphWithConfigSchema = new StateGraph(
    MessagesAnnotation,
    ConfigurableAnnotation
  )
    .addNode("printNode", printNode)
    .addEdge(START, "printNode")
    .compile();

  const result = await graphWithConfigSchema.invoke(
    {
      messages: [{ role: "user", content: "Echo!" }],
    },
    {
      configurable: {
        expectedField: "I am expected",
        unexpectedField: "I am unexpected but present",
      },
    }
  );

  RESULT.push(result);
  /* --------------------------------- result --------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT.json", JSON.stringify(RESULT, null, 2), "utf8");
})();
