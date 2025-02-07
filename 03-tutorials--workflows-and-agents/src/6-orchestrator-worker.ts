import { StateGraph, Annotation, Send } from "@langchain/langgraph";
import { z } from "zod";
import { ChatOllama } from "@langchain/ollama";
import * as fs from "fs";

(async () => {
  const llm = new ChatOllama({
    model: "llama3.2",
  });

  const sectionSchema = z.object({
    name: z.string().describe("name for this section of the report"),
    description: z
      .string()
      .describe(
        "Brief overview of the main topics and concepts to be covered in the section"
      ),
  });

  const sectionsSchema = z.object({
    sections: z.array(sectionSchema).describe("sections of the report"),
  });

  const planner = llm.withStructuredOutput(sectionsSchema);

  // Graph State
  const StateAnnotation = Annotation.Root({
    topic: Annotation<string>,
    sections: Annotation<z.infer<typeof sectionSchema>[]>,
    completedSections: Annotation<string[]>({
      default: () => [],
      reducer: (a, b) => a.concat(b),
    }),
    finalReport: Annotation<string>,
  });

  // Worker State
  const WorkerStateAnnotation = Annotation.Root({
    section: Annotation<z.infer<typeof sectionSchema>>,
    completedSections: Annotation<string[]>({
      default: () => [],
      reducer: (a, b) => a.concat(b),
    }),
  });

  async function orchestrator(state: typeof StateAnnotation.State) {
    const reportSections = await planner.invoke([
      { role: "system", content: "Generate a plan for the report." },
      { role: "user", content: `Here is the report topic: ${state.topic}` },
    ]);

    return {
      sections: reportSections.sections,
    };
  }

  async function llmCall(state: typeof WorkerStateAnnotation.State) {
    const section = await llm.invoke([
      {
        role: "system",
        content:
          "Write a report section following the provided name and description. Include no preamble for each section. Use markdown formatting.",
      },
      {
        role: "user",
        content: `Here is the section name: ${state.section.name} and description: ${state.section.description}`,
      },
    ]);

    return { completedSections: [section.content] };
  }

  async function synthesizer(state: typeof StateAnnotation.State) {
    return { finalReport: state.completedSections.join("\n\n") };
  }

  function assignWorkers(state: typeof StateAnnotation.State) {
    console.log("assignWorkers > state.sections > ", state.sections);
    console.log(
      "assignWorkers > state.sections > isArray",
      Array.isArray(state.sections)
    );

    return state.sections.map((section) => new Send("llmCall", { section }));
  }

  const orchestratorWorker = new StateGraph(StateAnnotation)
    .addNode("orchestrator", orchestrator)
    .addNode("llmCall", llmCall)
    .addNode("synthesizer", synthesizer)
    .addEdge("__start__", "orchestrator")
    .addConditionalEdges("orchestrator", assignWorkers, ["llmCall"])
    .addEdge("llmCall", "synthesizer")
    .addEdge("synthesizer", "__end__")
    .compile();

  const state = await orchestratorWorker.invoke({
    topic: "Create a report on AI Learning path",
  });

  // prettier-ignore
  const buffer = (await (await orchestratorWorker.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  fs.writeFileSync(
    "./graph-6-orchestrator-worker.png",
    Buffer.from(await buffer)
  );

  // prettier-ignore
  fs.writeFileSync("result-6-orchestrator-worker.json",JSON.stringify({ state }, null, 2),"utf8");
})();
