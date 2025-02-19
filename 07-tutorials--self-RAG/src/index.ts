import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import { DocumentInterface } from "@langchain/core/documents";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableConfig } from "@langchain/core/runnables";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { ChatOllama, OllamaEmbeddings } from "@langchain/ollama";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import * as fs from "fs";
import { formatDocumentsAsString } from "langchain/util/document";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
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
      default: () => "",
    }),
    generationVQuestionGrade: Annotation<string>({
      reducer: (x, y) => y ?? x,
    }),
    generationVDocumentsGrade: Annotation<string>({
      reducer: (x, y) => y ?? x,
    }),
  });

  /* -------------------------------------------------------------------------- */
  /*                               Nodes and Edges                              */
  /* -------------------------------------------------------------------------- */

  async function retrieveNode(
    state: typeof GraphState.State,
    config?: RunnableConfig
  ): Promise<Partial<typeof GraphState.State>> {
    WORKFLOW.push("node >> ---RETRIEVE---");
    WORKFLOW.push({ config });

    const documents = await retriever
      .withConfig({
        runName: "FetchRelevantDocuments",
      })
      .invoke(state.question, config);

    WORKFLOW.push({ documents });

    return { documents };
  }

  async function gradeDocumentsNode(
    state: typeof GraphState.State
  ): Promise<Partial<typeof GraphState.State>> {
    WORKFLOW.push("node >> ---gradeDocumentsNode---");
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

  async function generateNode(
    state: typeof GraphState.State
  ): Promise<Partial<typeof GraphState.State>> {
    WORKFLOW.push("node >> ---generateNode---");
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

  async function transformQueryNode(
    state: typeof GraphState.State
  ): Promise<Partial<typeof GraphState.State>> {
    WORKFLOW.push("node >> ---TRANSFORM QUERY---");

    const prompt = ChatPromptTemplate.fromTemplate(
      `
      You are generating a question that is well optimized for semantic search retrieval.
      Look at the input and try to reason about the underlying sematic intent / meaning.
      Here is the initial question:
      \n ------- \n
      {question} 
      \n ------- \n
      Formulate an improved question: 
      `
    );

    const chain = prompt.pipe(model).pipe(new StringOutputParser());
    const betterQuestion = await chain.invoke({ question: state.question });

    WORKFLOW.push(betterQuestion);

    return { question: betterQuestion };
  }

  async function decideToGenerateEdge(state: typeof GraphState.State) {
    WORKFLOW.push("Edge >> ---decideToGenerateEdge ---");
    const filteredDocuments = state.documents;
    if (filteredDocuments.length === 0) {
      WORKFLOW.push("Edge >> ", { return: "transformQueryNode" });
      return "transformQueryNode";
    }
    WORKFLOW.push("Edge >> ", { return: "generateNode" });
    return "generateNode";
  }

  async function generateGenerationVDocumentsGradeNode(
    state: typeof GraphState.State
  ): Promise<Partial<typeof GraphState.State>> {
    WORKFLOW.push("node---generateGenerationVDocumentsGradeNode---");

    const llmWithTool = model.withStructuredOutput(
      z
        .object({
          binaryScore: z
            .enum(["yes", "no"])
            .describe("Relevance score 'yes' or 'no' "),
        })
        .describe(
          "Grade the relevance of the retrieved documents to the question. Either 'yes' or 'no' "
        )
    );

    const prompt = ChatPromptTemplate.fromTemplate(
      `
      You are a grader assessing whether an answer is grounded in / supported by a set of facts.
      Here are the facts:
      \n ------- \n
      {documents} 
      \n ------- \n
      Here is the answer: {generation}

      Please evaluate the answer based on these criteria:

      * **Accuracy:** Does the answer accurately reflect the information in the facts?
      * **Inference:** Can the answer be logically inferred from the facts?
      * **Consistency:** Does the answer avoid contradicting any of the facts?
* 
      Give a binary score 'yes' or 'no' to indicate whether the answer is grounded in / supported by a set of facts.
      `
    );

    const chain = prompt.pipe(llmWithTool);

    const score = await chain.invoke({
      documents: formatDocumentsAsString(state.documents),
      generation: state.generation,
    });

    WORKFLOW.push({
      generateGenerationVDocumentsGrade: score.binaryScore,
    });

    return {
      generationVDocumentsGrade: score.binaryScore,
    };
  }

  async function gradeGenerationVDocumentsEdge(state: typeof GraphState.State) {
    WORKFLOW.push("Edge ---gradeGenerationVDocumentsEdge---");

    const grade = state.generationVDocumentsGrade;
    if (grade === "yes") {
      WORKFLOW.push("supported");
      return "supported";
    }
    WORKFLOW.push("not supported");
    return "not supported";
  }

  async function generateGenerationVQuestionGradeNode(
    state: typeof GraphState.State
  ): Promise<Partial<typeof GraphState.State>> {
    WORKFLOW.push("node---generateGenerationVQuestionGradeNode---");

    const llmWithTool = model.withStructuredOutput(
      z
        .object({
          binaryScore: z
            .enum(["yes", "no"])
            .describe("Relevance score 'yes' or 'no'"),
        })
        .describe(
          "Grade the relevance of the retrieved documents to the question. Either 'yes' or 'no'."
        ),
      {
        name: "grade",
      }
    );

    const prompt = ChatPromptTemplate.fromTemplate(
      `You are a grader assessing whether an answer is useful to resolve a question.
        Here is the answer:
        \n ------- \n
        {generation} 
        \n ------- \n
        Here is the question: {question}
        Give a binary score 'yes' or 'no' to indicate whether the answer is useful to resolve a question.`
    );

    const chain = prompt.pipe(llmWithTool);

    const score = await chain.invoke({
      question: state.question,
      generation: state.generation,
    });

    WORKFLOW.push({ generationVQuestionGrade: score.binaryScore });

    return {
      generationVQuestionGrade: score.binaryScore,
    };
  }

  async function gradeGenerationVQuestionEdge(state: typeof GraphState.State) {
    WORKFLOW.push("edge---gradeGenerationVQuestionEdge---");

    const grade = state.generationVQuestionGrade;
    if (grade === "yes") {
      WORKFLOW.push("useful");
      return "useful";
    }
    WORKFLOW.push("not useful");
    return "not useful";
  }

  /* -------------------------------------------------------------------------- */
  /*                                    GRAPH                                   */
  /* -------------------------------------------------------------------------- */

  const workflow = new StateGraph(GraphState)
    .addNode("retrieveNode", retrieveNode)
    .addNode("gradeDocumentsNode", gradeDocumentsNode)
    .addNode("generateNode", generateNode)
    .addNode("transformQueryNode", transformQueryNode)
    .addNode(
      "generateGenerationVDocumentsGradeNode",
      generateGenerationVDocumentsGradeNode
    )
    .addNode(
      "generateGenerationVQuestionGradeNode",
      generateGenerationVQuestionGradeNode
    )
    .addEdge(START, "retrieveNode")
    .addEdge("retrieveNode", "gradeDocumentsNode")
    .addConditionalEdges("gradeDocumentsNode", decideToGenerateEdge, [
      "transformQueryNode",
      "generateNode",
    ])
    .addEdge("transformQueryNode", "retrieveNode")
    .addEdge("generateNode", "generateGenerationVDocumentsGradeNode")
    .addConditionalEdges(
      "generateGenerationVDocumentsGradeNode",
      gradeGenerationVDocumentsEdge,
      {
        supported: "generateGenerationVQuestionGradeNode",
        "not supported": "generateNode",
      }
    )
    .addConditionalEdges(
      "generateGenerationVQuestionGradeNode",
      gradeGenerationVQuestionEdge,
      {
        useful: END,
        "not useful": "transformQueryNode",
      }
    );

  const app = workflow.compile();
  const inputs = {
    question: "Explain how the different types of agent memory work.",
  };
  const config = { recursionLimit: 50 };

  const prettifyOutput = (output: Record<string, any>) => {
    const key = Object.keys(output)[0];
    const value = output[key];
    console.log(`Node: '${key}'`);
    if (key === "retrieve" && "documents" in value) {
      console.log(`Retrieved ${value.documents.length} documents.`);
    } else if (key === "gradeDocuments" && "documents" in value) {
      console.log(
        `Graded documents. Found ${value.documents.length} relevant document(s).`
      );
    } else {
      console.dir(value, { depth: null });
    }
  };

  for await (const output of await app.stream(inputs, config)) {
    // prettier-ignore
    fs.writeFileSync("result.json",JSON.stringify(WORKFLOW, null, 2),"utf8");
    prettifyOutput(output);
    console.log("\n---ITERATION END---\n");
  }

  // prettier-ignore
  const buffer = (await (await app.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  fs.writeFileSync("./index.png", Buffer.from(await buffer));

  // prettier-ignore
  fs.writeFileSync("result.json",JSON.stringify(WORKFLOW, null, 2),"utf8");
})();
