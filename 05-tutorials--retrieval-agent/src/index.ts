import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { ChatOllama, OllamaEmbeddings } from "@langchain/ollama";
import { createRetrieverTool } from "langchain/tools/retriever";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { BaseMessage, AIMessage, HumanMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { pull } from "langchain/hub";
import { ToolNode } from "@langchain/langgraph/prebuilt";

import * as fs from "fs";
import { z } from "zod";

(async () => {
  const WORKFLOW: any[] = [];
  const urls = [
    "https://lilianweng.github.io/posts/2023-06-23-agent/",
    // "https://lilianweng.github.io/posts/2023-03-15-prompt-engineering/",
    // "https://lilianweng.github.io/posts/2023-10-25-adv-attack-llm/",
  ];

  const docs = await Promise.all(
    urls.map((url) => new CheerioWebBaseLoader(url).load())
  );

  const docsList = docs.flat();

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 50,
  });

  const docsSplits = await textSplitter.splitDocuments(docsList);

  const vectorStore = await MemoryVectorStore.fromDocuments(
    docsSplits,
    new OllamaEmbeddings({ model: "mxbai-embed-large" })
  );

  const retriever = vectorStore.asRetriever();

  const retrieverTool = createRetrieverTool(retriever, {
    name: "retrieve_blog_posts",
    description:
      "Search and return information about Lilian Weng blog posts on LLM agents, prompt engineering, and adversarial attacks on LLMs.",
  });
  const tools = [retrieverTool];
  /* ---------------------------------- GRAPH --------------------------------- */

  const GraphState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
      reducer: (x, y) => x.concat(y),
      default: () => [],
    }),
  });

  /* -------------------------------------------------------------------------- */
  /*                                    Nodes                                   */
  /* -------------------------------------------------------------------------- */

  async function agentNode(
    state: typeof GraphState.State
  ): Promise<Partial<typeof GraphState.State>> {
    const { messages } = state;
    WORKFLOW.push("start > ---AGENT NODE---");
    WORKFLOW.push(messages);

    // Find the AIMessage which contains the `give_relevance_score` tool call,
    // and remove it if it exists. This is because the agent does not need to know
    // the relevance score.
    const filteredMessages = messages.filter((message) => {
      if (
        "tool_calls" in message &&
        Array.isArray(message.tool_calls) &&
        message.tool_calls.length > 0
      ) {
        return message.tool_calls[0].name !== "grade_relevance_score";
      }
      return true;
    });

    WORKFLOW.push(filteredMessages);

    const model = new ChatOllama({
      model: "llama3.2",
      temperature: 0,
      streaming: true,
    }).bindTools(tools);

    const response = await model.invoke(filteredMessages);
    response.tool_calls;

    WORKFLOW.push(response);

    return {
      messages: [response],
    };
  }

  function shouldRetrieveConditionalEdge(
    state: typeof GraphState.State
  ): string {
    WORKFLOW.push("start > ---DECIDE TO RETRIEVE---");

    const { messages } = state;
    const lastMessage = messages[messages.length - 1];

    WORKFLOW.push(messages);

    if (
      "tool_calls" in lastMessage &&
      Array.isArray(lastMessage.tool_calls) &&
      lastMessage.tool_calls.length
    ) {
      return "retrieverNode";
    }
    return "__end__";
  }

  const retrieverNode = new ToolNode<typeof GraphState.State>(tools);

  async function gradeDocumentsNode(
    state: typeof GraphState.State
  ): Promise<Partial<typeof GraphState.State>> {
    WORKFLOW.push("---GET RELEVANCE---");
    const { messages } = state;
    WORKFLOW.push(messages);

    const tool = {
      name: "grade_relevance_score",
      description: "Give a relevance score to the retrieved documents.",
      schema: z.object({
        binaryScore: z.string().describe("Relevance score 'yes' or 'no'"),
      }),
    };

    const prompt = ChatPromptTemplate.fromTemplate(
      `
        You are a grader assessing relevance of retrieved docs to a user question.
        Here are the retrieved docs:
        \n ------- \n
        {context} 
        \n ------- \n
        Here is the user question: {question}
        If the content of the docs are relevant to the users question, score them as relevant.
        Give a binary score 'yes' or 'no' score to indicate whether the docs are relevant to the question.
        Yes: The docs are relevant to the question.
        No: The docs are not relevant to the question.
      `
    );

    const model = new ChatOllama({
      model: "llama3.2",
      temperature: 0,
    }).bindTools([tool], {
      // tool_choice: tool.name,
    });

    const chain = prompt.pipe(model);

    const lastMessage = messages[messages.length - 1];

    const score = await chain.invoke({
      question: messages[0].content,
      context: lastMessage.content,
    });

    WORKFLOW.push({ score });

    return {
      messages: [score],
    };
  }

  function checkRelevanceConditionalEdge(
    state: typeof GraphState.State
  ): string {
    WORKFLOW.push("---CHECK RELEVANCE---");
    const { messages } = state;
    WORKFLOW.push(messages);

    const lastMessage = messages[messages.length - 1];
    if (!("tool_calls" in lastMessage)) {
      throw new Error(
        "The 'checkRelevance' node requires the most recent message to contain tool calls."
      );
    }

    const toolCalls = (lastMessage as AIMessage).tool_calls;
    if (!toolCalls || !toolCalls.length) {
      throw new Error("Last message was not a function message");
    }

    if (toolCalls[0].args.binaryScore === "yes") {
      WORKFLOW.push("---DECISION: DOCS RELEVANT---");
      return "yes";
    }
    WORKFLOW.push("---DECISION: DOCS NOT RELEVANT---");
    return "no";
  }

  async function rewriteNode(
    state: typeof GraphState.State
  ): Promise<Partial<typeof GraphState.State>> {
    WORKFLOW.push("---REWRITE---");

    const { messages } = state;
    WORKFLOW.push(state.messages);

    const question = messages[0].content as string;
    const prompt = ChatPromptTemplate.fromTemplate(
      `Look at the input and try to reason about the underlying semantic intent / meaning. \n 
      Here is the initial question:
      \n ------- \n
      {question} 
      \n ------- \n
      Formulate an improved question:
      `
    );

    // Grader
    const model = new ChatOllama({
      model: "llama3.2",
      temperature: 0,
      streaming: true,
    });
    const response = await prompt.pipe(model).invoke({ question });

    WORKFLOW.push(response);

    return {
      messages: [response],
    };
  }

  async function generateNode(
    state: typeof GraphState.State
  ): Promise<Partial<typeof GraphState.State>> {
    WORKFLOW.push("---GENERATE---");
    const { messages } = state;
    WORKFLOW.push(messages);
    const question = messages[0].content as string;
    // Extract the most recent ToolMessage
    const lastToolMessage = messages
      .slice()
      .reverse()
      .find((msg) => msg.getType() === "tool");
    if (!lastToolMessage) {
      throw new Error("No tool message found in the conversation history");
    }

    const docs = lastToolMessage.content as string;

    const prompt = await pull<ChatPromptTemplate>("rlm/rag-prompt");

    const llm = new ChatOllama({
      model: "llama3.2",
      temperature: 0,
      streaming: true,
    });

    const ragChain = prompt.pipe(llm);

    const response = await ragChain.invoke({
      context: docs,
      question,
    });

    WORKFLOW.push(response);

    return {
      messages: [response],
    };
  }

  const graph = new StateGraph(GraphState)
    // Define the nodes which we'll cycle between.
    .addNode("agentNode", agentNode)
    .addNode("retrieverNode", retrieverNode)
    .addNode("gradeDocumentsNode", gradeDocumentsNode)
    .addNode("rewriteNode", rewriteNode)
    .addNode("generateNode", generateNode)
    .addEdge(START, "agentNode")
    .addConditionalEdges("agentNode", shouldRetrieveConditionalEdge, {
      retrieverNode: "retrieverNode",
      __end__: "__end__",
    })
    .addEdge("retrieverNode", "gradeDocumentsNode")
    .addConditionalEdges("gradeDocumentsNode", checkRelevanceConditionalEdge, {
      yes: "generateNode",
      no: "rewriteNode",
    })
    .addEdge("generateNode", "__end__")
    .addEdge("rewriteNode", "agentNode")
    .compile();

  // prettier-ignore
  fs.writeFileSync("index.json",JSON.stringify({ docs, docsList }, null, 2),"utf8");

  const inputs = {
    messages: [
      new HumanMessage(
        "What are the types of agent memory based on Lilian Weng's blog post?"
      ),
    ],
  };
  let finalState;
  for await (const output of await graph.stream(inputs)) {
    for (const [key, value] of Object.entries(output)) {
      const lastMsg = output[key].messages[output[key].messages.length - 1];
      console.log(`Output from node: '${key}'`);
      console.dir(
        {
          type: lastMsg._getType(),
          content: lastMsg.content,
          tool_calls: lastMsg.tool_calls,
        },
        { depth: null }
      );
      console.log("---\n");
      finalState = value;
    }
  }

  console.log(JSON.stringify(finalState, null, 2));

  // prettier-ignore
  const buffer = (await (await graph.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  fs.writeFileSync("./index.png", Buffer.from(await buffer));

  // prettier-ignore
  fs.writeFileSync("result.json",JSON.stringify(WORKFLOW, null, 2),"utf8");
})();
