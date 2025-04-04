import { Annotation, Command, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import * as fs from "fs/promises";

(async () => {
  let RESULT: (object | string)[] = [];

  const model = new ChatOpenAI({
    model: "gpt-4o",
    temperature: 0.1,
  });

  const GameStateAnnotation = Annotation.Root({
    wood: Annotation<number>({
      default: () => 0,
      reducer: (a, b) => a + b,
    }),
    food: Annotation<number>({
      default: () => 0,
      reducer: (a, b) => a + b,
    }),
    gold: Annotation<number>({
      default: () => 0,
      reducer: (a, b) => a + b,
    }),
    guardOnDuty: Annotation<boolean>,
  });

  const villager = async (state: typeof GameStateAnnotation.State) => {
    const currentResources = state.wood + state.food;

    if (currentResources < 15) {
      console.log("Villager gathering resources.");
      return new Command({
        goto: "villager",
        update: {
          wood: 3,
          food: 1,
        },
      });
    }

    return new Command({
      goto: "__end__",
    });
  };

  const guard = async (state: typeof GameStateAnnotation.State) => {
    if (!state.guardOnDuty) {
      return new Command({
        goto: "__end__",
      });
    }
    if (state.food > 0) {
      console.log("Guard patrolling.");
      return new Command({
        goto: "guard",
        update: { food: -1 },
      });
    }
    console.log("Guard leaving to get food.");
    return new Command({
      goto: "__end__",
      update: {
        guardOnDuty: false,
      },
    });
  };

  const merchant = async (state: typeof GameStateAnnotation.State) => {
    if (state.wood >= 5) {
      console.log("Merchant trading wood for gold.");
      return new Command({
        goto: "merchant",
        update: {
          wood: -5,
          gold: 1,
        },
      });
    }
    return new Command({
      goto: "__end__",
    });
  };

  const thief = async (state: typeof GameStateAnnotation.State) => {
    if (!state.guardOnDuty) {
      console.log("Thief stealing gold.");
      return new Command({
        goto: "__end__",
        update: { gold: -state.gold },
      });
    }
    return new Command({
      goto: "thief",
    });
  };

  const gameGraph = new StateGraph(GameStateAnnotation)
    .addNode("villager", villager, {
      ends: ["villager", "__end__"],
    })
    .addNode("guard", guard, {
      ends: ["guard", "__end__"],
    })
    .addNode("merchant", merchant, {
      ends: ["merchant", "__end__"],
    })
    .addNode("thief", thief, {
      ends: ["thief", "__end__"],
    })
    .addEdge("__start__", "villager")
    .addEdge("__start__", "guard")
    .addEdge("__start__", "merchant")
    .addEdge("__start__", "thief")
    .compile();

  // prettier-ignore
  const buffer = (await (await gameGraph.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./diagram.png", Buffer.from(await buffer));

  /* --------------------------------- stream --------------------------------- */

  const gameStream = await gameGraph.stream(
    {
      wood: 10,
      food: 3,
      gold: 10,
      guardOnDuty: true,
    },
    {
      streamMode: "values",
    }
  );

  for await (const state of gameStream) {
    console.log("Game state", state);
    console.log("-".repeat(50));

    RESULT.push(state);
  }

  /* --------------------------------- result --------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT.json", JSON.stringify(RESULT, null, 2), "utf8");
})();
