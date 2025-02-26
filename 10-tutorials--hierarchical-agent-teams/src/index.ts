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
import { JsonOutputToolsParser } from "@langchain/core/output_parsers/openai_tools";

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

import * as d3 from "d3";
import * as fs from "fs/promises";
import { z } from "zod";
import * as path from "path";

(async () => {
  const RESULT: (object | string)[] = [];
  /* ---------------------------------- Tools --------------------------------- */

  const tavilyTool = new TavilySearchResults();

  const scrapeWebPage = tool(
    async (input) => {
      const loader = new CheerioWebBaseLoader(input.url);
      const docs = await loader.load();
      const formattedDocs = docs.map(
        (doc) =>
          `<document title={${doc.metadata.title}}>{${doc.pageContent}}</document>`
      );

      return formattedDocs.join("\n\n");
    },
    {
      name: "scrape_web_page",
      description: "Scrapes a webpage",
      schema: z.object({
        url: z.string(),
      }),
    }
  );

  RESULT.push(
    await scrapeWebPage.invoke({
      url: "https://elevista.ai/blog/audience-engagement",
    })
  );

  const WORKING_DIRECTORY = "./working_directory";
  await fs.mkdir(WORKING_DIRECTORY, { recursive: true });

  const createOutlineTool = tool(
    async (input) => {
      const filePath = path.join(WORKING_DIRECTORY, input.fileName);
      const data = input.points
        .map((point, index) => `${index + 1}. ${point}`)
        .join("\n");
      await fs.writeFile(filePath, data);
      return `Outline saved to ${input.fileName}`;
    },
    {
      name: "create_outline",
      description: "Create and save an outline.",
      schema: z.object({
        points: z
          .array(z.string())
          .nonempty("List of main points or sections must not be empty."),
        fileName: z.string(),
      }),
    }
  );

  await createOutlineTool.invoke({
    points: [
      "Introduction",
      "Background",
      "Methodology",
      "Results",
      "Discussion",
    ],
    fileName: "outline.txt",
  });

  const readDocumentTool = tool(
    async (input) => {
      const filePath = path.join(WORKING_DIRECTORY, input.fileName);
      const data = await fs.readFile(filePath, "utf-8");
      const lines = data.split("\n");
      const start = input.start ?? 0;
      const end = input.end ?? lines.length;
      return lines.slice(start, end).join("\n");
    },
    {
      name: "read_document",
      description: "Reads a document and returns the content.",
      schema: z.object({
        fileName: z.string(),
        start: z.number().optional().describe("Starting line of reading."),
        end: z.number().optional().describe("end line of reading."),
      }),
    }
  );

  RESULT.push(
    await readDocumentTool.invoke({
      fileName: "outline.txt",
      start: 1,
      end: 3,
    })
  );

  const writeDocumentTool = tool(
    async (input) => {
      const filePath = path.join(WORKING_DIRECTORY, input.fileName);
      await fs.writeFile(filePath, input.content);
      return `Document ${input.fileName} has been written.`;
    },
    {
      name: "write_document",
      description: "Writes to a document.",
      schema: z.object({
        fileName: z.string(),
        content: z.string(),
      }),
    }
  );

  await writeDocumentTool.invoke({
    fileName: "outline-2.txt",
    content: "content for outline-2.txt",
  });

  const editDocumentTool = tool(
    async (input) => {
      const filePath = path.join(WORKING_DIRECTORY, input.fileName);
      const data = await fs.readFile(filePath, "utf-8");
      const lines = data.split("\n");
      for (const [line, text] of Object.entries(input.insets)) {
        lines[Number(line) - 1] = text;
      }
      await fs.writeFile(filePath, lines.join("\n"));
      return `Document ${input.fileName} has been edited.`;
    },
    {
      name: "edit_document",
      description:
        "Edit a document by inserting text at specific line numbers.",
      schema: z.object({
        fileName: z.string(),
        insets: z.record(z.string(), z.string()),
      }),
    }
  );

  await editDocumentTool.invoke({
    fileName: "outline.txt",
    insets: {
      2: "2. This is an inserted line. (edited)",
    },
  });

  const chartTool = tool(
    async ({ data }) => {
      const width = 500;
      const height = 500;
      const margin = { top: 20, right: 30, bottom: 30, left: 40 };

      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");

      const x = d3
        .scaleBand()
        .domain(data.map((d) => d.label))
        .range([margin.left, width - margin.right])
        .padding(0.1);

      const y = d3
        .scaleLinear()
        .domain([0, d3.max(data, (d) => Number(d.value)) ?? 0])
        .nice()
        .range([height - margin.bottom, margin.top]);

      const colorPalette = [
        "#e6194B",
        "#3cb44b",
        "#ffe119",
        "#4363d8",
        "#f58231",
        "#911eb4",
        "#42d4f4",
        "#f032e6",
        "#bfef45",
        "#fabebe",
      ];

      data.forEach((d, idx) => {
        ctx.fillStyle = colorPalette[idx % colorPalette.length];
        ctx.fillRect(
          x(d.label) ?? 0,
          y(Number(d.value)),
          x.bandwidth(),
          height - margin.bottom - y(Number(d.value))
        );
      });

      ctx.beginPath();
      ctx.strokeStyle = "black";
      ctx.moveTo(margin.left, height - margin.bottom);
      ctx.lineTo(width - margin.right, height - margin.bottom);
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      x.domain().forEach((d) => {
        const xCoord = (x(d) ?? 0) + x.bandwidth() / 2;
        ctx.fillText(d, xCoord, height - margin.bottom + 6);
      });

      ctx.beginPath();
      ctx.moveTo(margin.left, height - margin.top);
      ctx.lineTo(margin.left, height - margin.bottom);
      ctx.stroke();

      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      const ticks = y.ticks();
      ticks.forEach((d) => {
        const yCoord = y(d); // height - margin.bottom - y(d);
        ctx.moveTo(margin.left, yCoord);
        ctx.lineTo(margin.left - 6, yCoord);
        ctx.stroke();
        ctx.fillText(d.toString(), margin.left - 8, yCoord);
      });
      // tslab.display.png(canvas.toBuffer());
      fs.writeFile("./chart.png", Buffer.from(await canvas.toBuffer()));

      return "Chart has been generated and displayed to the user!";
    },
    {
      name: "generate_bar_chart",
      description:
        "Generates a bar chart from an array of data points using D3.js and displays it for the user.",
      schema: z.object({
        data: z
          .object({
            label: z.string(),
            value: z.number(),
          })
          .array(),
      }),
    }
  );

  await chartTool.invoke({
    data: [
      { label: "A", value: 123 },
      { label: "B", value: 123 },
      { label: "C", value: 432 },
      { label: "D", value: 654 },
      { label: "E", value: 234 },
      { label: "F", value: 542 },
    ],
  });

  /* ---------------------------- Helper Utilities ---------------------------- */
  const agentStateModifier = ({
    systemPrompt,
    tools,
    teamMembers,
  }: {
    systemPrompt: string;
    tools: StructuredToolInterface[];
    teamMembers: string[];
  }): ((state: typeof MessagesAnnotation.State) => BaseMessage[]) => {
    const toolNames = tools.map((t) => t.name).join(", ");
    const systemMsgStart = new SystemMessage(
      systemPrompt +
        "\nWork autonomously according to your specialty, using the tools available to you." +
        " Do not ask for clarification." +
        " Your other team members (and other teams) will collaborate with you with their own specialties." +
        ` You are chosen for a reason! You are one of the following team members: ${teamMembers.join(
          ", "
        )}.`
    );
    const systemMsgEnd = new SystemMessage(
      `Supervisor instructions: ${systemPrompt}\n` +
        `Remember, you individually can only use these tools: ${toolNames}` +
        "\n\nEnd if you have already completed the requested task. Communicate the work completed."
    );

    return (state: typeof MessagesAnnotation.State) => [
      systemMsgStart,
      ...state.messages,
      systemMsgEnd,
    ];
  };

  async function runAgentNode(params: {
    state: typeof MessagesAnnotation.State;
    agent: Runnable;
    name: string;
  }) {
    const { state, agent, name } = params;
    const result = await agent.invoke(state);
    const lastMessage = result.messages[result.messages.length - 1];

    return {
      messages: [
        new HumanMessage({
          content: lastMessage.content,
          name,
        }),
      ],
    };
  }

  async function createTeamSupervisor({
    llm,
    systemPrompt,
    members,
  }: {
    llm: ChatOpenAI;
    systemPrompt: string;
    members: string[];
  }): Promise<Runnable> {
    const options = ["FINISH", ...members];
    const routeTool = {
      name: "route",
      description: "Select the next role.",
      schema: z.object({
        reasoning: z.string(),
        next: z.enum([END, ...members]),
        instructions: z
          .string()
          .describe(
            "The specific instructions of the sub-task the next role should accomplish."
          ),
      }),
    };

    let prompt = ChatPromptTemplate.fromMessages([
      ["system", systemPrompt],
      new MessagesPlaceholder("messages"),
      [
        "system",
        "Given the conversation above, who should act next? Or should we FINISH? Select one of: {options}",
      ],
    ]);

    prompt = await prompt.partial({
      options: options.join(", "),
      members: members.join(", "),
    });

    const supervisor = prompt
      .pipe(
        llm.bindTools([routeTool], {
          tool_choice: "route",
        })
      )
      .pipe(new JsonOutputToolsParser())
      .pipe((x: { args: { next: string; instructions: string } }[]) => ({
        next: x[0].args.next,
        instructions: x[0].args.instructions,
      }));

    RESULT.push("createTeamSupervisor", {
      members,
      supervisorOutput: supervisor,
    });

    return supervisor;
  }

  /* ------------------------------ Research Team ----------------------------- */

  const ResearchTeamState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
      reducer: (x, y) => x.concat(y),
    }),
    teamMembers: Annotation<string[]>({
      reducer: (x, y) => x.concat(y),
    }),
    next: Annotation<string>({
      reducer: (x, y) => y ?? x,
      default: () => "supervisor",
    }),
    instructions: Annotation<string>({
      reducer: (x, y) => y ?? x,
      default: () => "Solve the human's question",
    }),
  });

  const llm = new ChatOpenAI({ model: "gpt-4o" });

  const searchNode = async (state: typeof ResearchTeamState.State) => {
    const stateModifier = agentStateModifier({
      systemPrompt:
        "You are a research assistant who can search for up-to-date info using the tavily search engine.",
      tools: [tavilyTool],
      teamMembers: state.teamMembers ?? ["Search"],
    });

    const searchAgent = createReactAgent({
      llm,
      tools: [tavilyTool],
      stateModifier,
    });

    const output = await runAgentNode({
      state,
      agent: searchAgent,
      name: "Search",
    });

    RESULT.push({ searchNodeOutput: output });

    return output;
  };

  const researchNode = async (state: typeof ResearchTeamState.State) => {
    const stateModifier = agentStateModifier({
      systemPrompt:
        "You are a research assistant who can scrape specified urls for more detailed information using the scrapeWebpage function.",
      tools: [scrapeWebPage],
      teamMembers: state.teamMembers ?? ["ScrapeWebpage"],
    });

    const researchAgent = createReactAgent({
      llm,
      tools: [scrapeWebPage],
      stateModifier,
    });

    const output = await runAgentNode({
      state,
      agent: researchAgent,
      name: "ScrapeWebpage",
    });

    RESULT.push({ researchNodeOutput: output });

    return output;
  };

  const supervisorAgent = await createTeamSupervisor({
    llm,
    systemPrompt:
      "You are a supervisor tasked with managing a conversation between the" +
      " following workers:  {members}. Given the following user request," +
      " respond with the worker to act next. Each worker will perform a" +
      " task and respond with their results and status. When finished," +
      " respond with FINISH.\n\n" +
      " Select strategically to minimize the number of steps taken.",
    members: ["Search", "ScrapeWebpage"],
  });

  const researchTeamGraph = new StateGraph(ResearchTeamState)
    .addNode("searchNode", searchNode)
    .addNode("researchNode", researchNode)
    .addNode("supervisor", supervisorAgent)
    .addEdge("searchNode", "supervisor")
    .addEdge("researchNode", "supervisor")
    .addConditionalEdges("supervisor", (x) => x.next, {
      Search: "searchNode",
      ScrapeWebpage: "researchNode",
      FINISH: END,
    })
    .addEdge(START, "supervisor");

  const researchChain = researchTeamGraph.compile();

  // prettier-ignore
  const buffer = (await (await researchChain.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  fs.writeFile("./research-team-graph.png", Buffer.from(await buffer));

  const streamResults = researchChain.stream(
    {
      messages: [
        new HumanMessage("What's the price of a big mac in Argentina?"),
      ],
    },
    { recursionLimit: 100 }
  );
  for await (const output of await streamResults) {
    if (!output?.__end__) {
      console.log(output);
      console.log("----");
    }
  }

  /* ---------------------------------- State --------------------------------- */
  // const AgentState = Annotation.Root({
  //   messages: Annotation<BaseMessage[]>({
  //     reducer: (x, y) => y ?? x ?? [],
  //     default: () => [],
  //   }),
  //   next: Annotation<string>({
  //     reducer: (x, y) => y ?? x ?? END,
  //     default: () => END,
  //   }),
  // });

  /* ---------------------------------- Tools --------------------------------- */

  // const chartTool = new DynamicStructuredTool({
  //   name: "generate_bar_chart",
  //   description:
  //     "Generates a bar chart from an array of data points using D3.js and displays it for the user.",
  //   schema: z.object({
  //     data: z
  //       .object({
  //         label: z.string(),
  //         value: z.number(),
  //       })
  //       .array(),
  //   }),
  //   func: async ({ data }) => {
  //     const width = 500;
  //     const height = 500;
  //     const margin = { top: 20, right: 30, bottom: 30, left: 40 };

  //     const canvas = createCanvas(width, height);
  //     const ctx = canvas.getContext("2d");

  //     const x = d3
  //       .scaleBand()
  //       .domain(data.map((d) => d.label))
  //       .range([margin.left, width - margin.right])
  //       .padding(0.1);

  //     const y = d3
  //       .scaleLinear()
  //       .domain([0, d3.max(data, (d) => d.value) ?? 0])
  //       .nice()
  //       .range([height - margin.bottom, margin.top]);

  //     const colorPalette = [
  //       "#e6194B",
  //       "#3cb44b",
  //       "#ffe119",
  //       "#4363d8",
  //       "#f58231",
  //       "#911eb4",
  //       "#42d4f4",
  //       "#f032e6",
  //       "#bfef45",
  //       "#fabebe",
  //     ];

  //     data.forEach((d, idx) => {
  //       ctx.fillStyle = colorPalette[idx % colorPalette.length];
  //       ctx.fillRect(
  //         x(d.label) ?? 0,
  //         y(d.value),
  //         x.bandwidth(),
  //         height - margin.bottom - y(d.value)
  //       );
  //     });

  //     ctx.beginPath();
  //     ctx.strokeStyle = "black";
  //     ctx.moveTo(margin.left, height - margin.bottom);
  //     ctx.lineTo(width - margin.right, height - margin.bottom);
  //     ctx.stroke();

  //     ctx.textAlign = "center";
  //     ctx.textBaseline = "top";
  //     x.domain().forEach((d) => {
  //       const xCoord = (x(d) ?? 0) + x.bandwidth() / 2;
  //       ctx.fillText(d, xCoord, height - margin.bottom + 6);
  //     });

  //     ctx.beginPath();
  //     ctx.moveTo(margin.left, height - margin.top);
  //     ctx.lineTo(margin.left, height - margin.bottom);
  //     ctx.stroke();

  //     ctx.textAlign = "right";
  //     ctx.textBaseline = "middle";
  //     const ticks = y.ticks();
  //     ticks.forEach((d) => {
  //       const yCoord = y(d); // height - margin.bottom - y(d);
  //       ctx.moveTo(margin.left, yCoord);
  //       ctx.lineTo(margin.left - 6, yCoord);
  //       ctx.stroke();
  //       ctx.fillText(d.toString(), margin.left - 8, yCoord);
  //     });

  //     fs.writeFileSync("./chart.png", Buffer.from(await canvas.toBuffer()));
  //     return "Chart has been generated and displayed to the user!";
  //   },
  // });

  /* ---------------------------- Agent Supervisor ---------------------------- */

  // const members: ["researcherNode", "chartGeneratorNode"] = [
  //   "researcherNode",
  //   "chartGeneratorNode",
  // ];

  // const systemPrompt =
  //   " You are a supervisor tasked with managing a conversation between the" +
  //   " following workers: {members}. Given the following user request," +
  //   " respond with the worker to act next. Each worker will perform a" +
  //   " task and respond with their results and status. When finished," +
  //   " respond with FINISH.";

  // const options = [...members, END];

  // const routingTool = {
  //   name: "route",
  //   description: "Select the next role.",
  //   schema: z.object({
  //     next: z.enum([END, ...members]),
  //   }),
  // };

  // const prompt = ChatPromptTemplate.fromMessages([
  //   ["system", systemPrompt],
  //   new MessagesPlaceholder("messages"),
  //   [
  //     "human",
  //     "Given the conversation above, who should act next ? Or should we FINISH? Select one of {options}",
  //   ],
  // ]);

  // const formattedPrompt = await prompt.partial({
  //   options: options.join(", "),
  //   members: members.join(", "),
  // });

  // const llm = new ChatGoogleGenerativeAI({ model: "gemini-1.5-pro" });

  // const supervisorChain = formattedPrompt
  //   .pipe(llm.bindTools([routingTool], { tool_choice: "route" }))
  //   .pipe((x) => {
  //     console.log("x > ", x);
  //     // @ts-ignore
  //     return x.tool_calls[0].args;
  //   });

  // const response1 = await supervisorChain.invoke({
  //   messages: [
  //     new HumanMessage({
  //       content: "write a report on birds.",
  //     }),
  //   ],
  // });

  // const response2 = await supervisorChain.invoke({
  //   messages: [
  //     new HumanMessage({
  //       content:
  //         "generate a bar chart fot this data [A,B,C,D,E,F] [123, 123, 432, 654, 234, 542]",
  //     }),
  //   ],
  // });

  // console.log({ response1, response2 });

  /* ----------------------------- researcherNode ----------------------------- */

  // const researcherNode = async (
  //   state: typeof AgentState.State,
  //   config?: RunnableConfig
  // ) => {
  //   const researcherAgent = createReactAgent({
  //     llm,
  //     tools: [tavilyTool],
  //     stateModifier: new SystemMessage(
  //       "You are a web researcher. You may use the Tavily search engine to search the web for" +
  //         " important information, so the Chart Generator in your team can make useful plots."
  //     ),
  //   });

  //   const result = await researcherAgent.invoke(state, config);
  //   const lastMessage = result.messages[result.messages.length - 1];

  //   return {
  //     messages: [new HumanMessage({ content: lastMessage.content })],
  //   };
  // };

  /* --------------------------- chartGeneratorNode --------------------------- */

  // const chartGeneratorNode = async (
  //   state: typeof AgentState.State,
  //   config?: RunnableConfig
  // ) => {
  //   const chartGeneratorAgent = createReactAgent({
  //     llm,
  //     tools: [chartTool],
  //     stateModifier: new SystemMessage(
  //       "You excel at generating bar charts. Use the researcher's information to generate the charts."
  //     ),
  //   });

  //   const result = await chartGeneratorAgent.invoke(state, config);
  //   const lastMessage = result.messages[result.messages.length - 1];

  //   return {
  //     messages: [
  //       new HumanMessage({
  //         content: lastMessage.content,
  //       }),
  //     ],
  //   };
  // };

  /* ---------------------------------- Graph --------------------------------- */

  // const workflow = new StateGraph(AgentState)
  //   .addNode("researcherNode", researcherNode)
  //   .addNode("chartGeneratorNode", chartGeneratorNode)
  //   .addNode("supervisorChain", supervisorChain);

  // for (const member of members) {
  //   workflow.addEdge(member, "supervisorChain");
  // }

  // workflow.addConditionalEdges("supervisorChain", (x) => x.next);

  // workflow.addEdge(START, "supervisorChain");

  // const graph = workflow.compile();

  // // prettier-ignore
  // const buffer = (await (await graph.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  // fs.writeFileSync("./diagram-2.png", Buffer.from(await buffer));

  /* --------------------------------- output --------------------------------- */

  // let streamResults = graph.stream(
  //   {
  //     messages: [
  //       new HumanMessage({
  //         content: "What were the 3 most popular tv shows in 2023?",
  //       }),
  //     ],
  //   },
  //   { recursionLimit: 100 }
  // );

  // for await (const output of await streamResults) {
  //   if (!output?.__end__) {
  //     console.log(output);
  //     console.log("----");
  //   }
  // }

  // prettier-ignore
  fs.writeFile("result.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
