import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import { Document } from "@langchain/core/documents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { ChatOllama, OllamaEmbeddings } from "@langchain/ollama";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { pull } from "langchain/hub";
import { formatDocumentsAsString } from "langchain/util/document";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { DocumentInterface } from "@langchain/core/documents";
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
    chunkSize: 250,
    chunkOverlap: 50,
  });

  const docsSplits = await textSplitter.splitDocuments(docsList);

  const vectorStore = await MemoryVectorStore.fromDocuments(
    docsSplits,
    new OllamaEmbeddings({ model: "mxbai-embed-large" })
  );

  const retriever = vectorStore.asRetriever();

  /* -------------------------------------------------------------------------- */
  /*                                    model                                   */
  /* -------------------------------------------------------------------------- */

  const model = new ChatOllama({
    model: "llama3.2",
    temperature: 0,
  });

  /* -------------------------------------------------------------------------- */
  /*                                    Graph                                   */
  /* -------------------------------------------------------------------------- */

  const GraphState = Annotation.Root({
    documents: Annotation<DocumentInterface[]>({
      reducer: (x, y) => y ?? x ?? [],
    }),
    question: Annotation<string>({
      reducer: (x, y) => y ?? x ?? "",
    }),
    generation: Annotation<string>({
      reducer: (x, y) => y ?? x,
    }),
  });

  /* -------------------------------------------------------------------------- */
  /*                               Nodes and Edges                              */
  /* -------------------------------------------------------------------------- */

  async function retrieveNode(
    state: typeof GraphState.State
  ): Promise<Partial<typeof GraphState.State>> {
    WORKFLOW.push("node >> ---RETRIEVE---");

    const documents = await retriever
      .withConfig({
        runName: "FetchRelevantDocuments",
      })
      .invoke(state.question);

    WORKFLOW.push({ documents });
    return { documents };
  }

  async function gradeDocumentsNode(
    state: typeof GraphState.State
  ): Promise<Partial<typeof GraphState.State>> {
    WORKFLOW.push("node >> ---GRADE---");
    const { documents, question } = state;
    const llmWithTool = model.withStructuredOutput(
      z
        .object({
          binaryScore: z
            .enum(["no", "yes"])
            .describe("Relevance score 'yes' or 'no'"),
        })
        .describe(
          "Grade the relevance of the retrieved documents to the question. Either 'yes' or 'no'."
        ),
      {
        name: "grade",
      }
    );

    const prompt = ChatPromptTemplate.fromTemplate(`
      You are a strict grader assessing the relevance of a retrieved document to a user question.  You MUST answer with only "yes" or "no" – no other explanations or text are permitted.

      Here is the retrieved document:


      {context}

      Here is the user question: {question}

      A document is ONLY relevant if it contains keywords DIRECTLY from the user question OR expresses the EXACT SAME semantic meaning.  Synonyms, related concepts, or tangential information are NOT sufficient for relevance.  If the document meets this strict criterion, answer "yes". Otherwise, answer "no".
    `);

    const chain = prompt.pipe(llmWithTool);

    const filteredDocuments: typeof GraphState.State.documents = [];
    for (const document of documents) {
      const grade = await chain.invoke({
        context: document.pageContent,
        question,
      });

      console.log({ grade, context: document.pageContent, question });

      if (grade.binaryScore === "yes") {
        WORKFLOW.push("---GRADE: DOCUMENT RELEVANT---", { document });
        filteredDocuments.push(document);
      } else {
        WORKFLOW.push("---GRADE: DOCUMENT NOT RELEVANT---", { document });
      }
    }

    return {
      documents: filteredDocuments,
    };
  }

  async function transformQueryNode(
    state: typeof GraphState.State
  ): Promise<Partial<typeof GraphState.State>> {
    WORKFLOW.push("node >> ---TRANSFORM QUERY---");

    const prompt = ChatPromptTemplate.fromTemplate(
      `
      You are tasked with generating an optimized question for semantic search retrieval. Analyze the input to understand the underlying semantic intent and meaning.
      Here is the initial question:
      \n ------- \n
      {question}
      \n ------- \n
      Formulate an improved question:
      
      Return only the improved question, ensuring it is no longer than 400 characters.
      `
    );

    const chain = prompt.pipe(model).pipe(new StringOutputParser());
    const betterQuestion = await chain.invoke({ question: state.question });

    WORKFLOW.push(betterQuestion);

    return { question: betterQuestion };
  }

  async function webSearchNode(
    state: typeof GraphState.State
  ): Promise<Partial<typeof GraphState.State>> {
    WORKFLOW.push("node >> ---WEB SEARCH---");
    WORKFLOW.push({ input: state.question });
    console.log({ input: state.question });

    const tool = new TavilySearchResults();
    const docs = await tool.invoke({ input: state.question });
    console.log({ docs });

    const webResults = new Document({ pageContent: docs });
    const newDocuments = state.documents.concat(webResults);
    WORKFLOW.push({ webResults });

    return {
      documents: newDocuments,
    };
  }

  async function decideToGenerateEdge(state: typeof GraphState.State) {
    WORKFLOW.push("Edge >> ---DECIDE TO GENERATE ---");
    const filteredDocuments = state.documents;
    if (filteredDocuments.length === 0) {
      WORKFLOW.push("Edge >> ", { return: "transformQueryNode" });
      return "transformQueryNode";
    }
    WORKFLOW.push("Edge >> ", { return: "generateNode" });
    return "generateNode";
  }

  async function generateNode(
    state: typeof GraphState.State
  ): Promise<Partial<typeof GraphState.State>> {
    WORKFLOW.push("node >> ---GENERATE---");
    console.log("node >> ---GENERATE---");
    // const prompt = await pull<ChatPromptTemplate>("rlm/rag-prompt");
    const prompt = ChatPromptTemplate.fromTemplate(`
      You are an assistant for question-answering tasks. Use the following pieces of retrieved context to answer the question. If you don't know the answer, just say that you don't know. Use three sentences maximum and keep the answer concise.
      Question: {question} 
      Context: {context} 
      Answer:
    `);
    WORKFLOW.push(prompt);

    const ragChain = prompt.pipe(model).pipe(new StringOutputParser());

    const generation = await ragChain.invoke({
      context: formatDocumentsAsString(state.documents),
      question: state.question,
    });

    WORKFLOW.push(generation);
    return { generation };
  }

  /* -------------------------------------------------------------------------- */
  /*                                    GRAPH                                   */
  /* -------------------------------------------------------------------------- */

  const workflow = new StateGraph(GraphState)
    .addNode("retrieveNode", retrieveNode)
    .addNode("gradeDocumentsNode", gradeDocumentsNode)
    .addNode("generateNode", generateNode)
    .addNode("transformQueryNode", transformQueryNode)
    .addNode("webSearchNode", webSearchNode)
    .addEdge(START, "retrieveNode")
    .addEdge("retrieveNode", "gradeDocumentsNode")
    .addConditionalEdges("gradeDocumentsNode", decideToGenerateEdge, [
      "transformQueryNode",
      "generateNode",
    ])
    .addEdge("transformQueryNode", "webSearchNode")
    .addEdge("webSearchNode", "generateNode")
    .addEdge("generateNode", END);

  const app = workflow.compile();

  const inputs: Partial<typeof GraphState.State> = {
    question: "whats the weather in LA ?",
  };

  let finalGeneration;
  const config = { recursionLimit: 50 };

  for await (const output of await app.stream(inputs, config)) {
    for (const [key, value] of Object.entries(output)) {
      console.log(`Node: '${key}'`);
      // Optional: log full state at each node
      // console.log(JSON.stringify(value, null, 2));
      finalGeneration = value;
    }
    console.log("\n---\n");
  }

  console.log(JSON.stringify(finalGeneration, null, 2));

  // prettier-ignore
  const buffer = (await (await app.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  fs.writeFileSync("./index.png", Buffer.from(await buffer));

  // prettier-ignore
  fs.writeFileSync("result.json",JSON.stringify(WORKFLOW, null, 2),"utf8");
})();
