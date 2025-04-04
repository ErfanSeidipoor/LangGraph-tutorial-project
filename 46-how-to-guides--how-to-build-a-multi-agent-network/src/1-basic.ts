import { Command, MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import * as fs from "fs/promises";
import { z } from "zod";

(async () => {
  let RESULT: (object | string)[] = [];

  const model = new ChatOpenAI({
    model: "gpt-4o",
    temperature: 0.1,
  });

  /* ------------------------------- agent node ------------------------------- */

  const makeAgentNode = (params: {
    name: string;
    destinations: string[];
    systemPrompt: string;
  }) => {
    return async (state: typeof MessagesAnnotation.State) => {
      const possibleDestinations = ["__end__", ...params.destinations] as const;
      const responseSchema = z.object({
        response: z
          .string()
          .describe(
            "A human readable response to the original question. Does not need to be a final response. Will be streamed back to the user."
          ),
        goto: z
          .enum(possibleDestinations)
          .describe(
            "The next agent to call, or __end__ if the user's query has been resolved. Must be one of the specified values."
          ),
      });
      const messages = [
        {
          role: "system",
          content: params.systemPrompt,
        },
        ...state.messages,
      ];
      const response = await model
        .withStructuredOutput(responseSchema, {
          name: "router",
        })
        .invoke(messages);

      // handoff to another agent or halt
      const aiMessage = {
        role: "assistant",
        content: response.response,
        name: params.name,
      };
      return new Command({
        goto: response.goto,
        update: { messages: aiMessage },
      });
    };
  };

  const travelAdvisor = makeAgentNode({
    name: "travel_advisor",
    destinations: ["sightseeing_advisor", "hotel_advisor"],
    systemPrompt: [
      "You are a general travel expert that can recommend travel destinations (e.g. countries, cities, etc). ",
      "If you need specific sightseeing recommendations, ask 'sightseeing_advisor' for help. ",
      "If you need hotel recommendations, ask 'hotel_advisor' for help. ",
      "If you have enough information to respond to the user, return '__end__'. ",
      "Never mention other agents by name.",
    ].join(""),
  });

  const sightseeingAdvisor = makeAgentNode({
    name: "sightseeing_advisor",
    destinations: ["travel_advisor", "hotel_advisor"],
    systemPrompt: [
      "You are a travel expert that can provide specific sightseeing recommendations for a given destination. ",
      "If you need general travel help, go to 'travel_advisor' for help. ",
      "If you need hotel recommendations, go to 'hotel_advisor' for help. ",
      "If you have enough information to respond to the user, return 'finish'. ",
      "Never mention other agents by name.",
    ].join(""),
  });

  const hotelAdvisor = makeAgentNode({
    name: "hotel_advisor",
    destinations: ["travel_advisor", "sightseeing_advisor"],
    systemPrompt: [
      "You are a booking expert that provides hotel recommendations for a given destination. ",
      "If you need general travel help, ask 'travel_advisor' for help. ",
      "If you need specific sightseeing recommendations, ask 'sightseeing_advisor' for help. ",
      "If you have enough information to respond to the user, return 'finish'. ",
      "Never mention other agents by name.",
    ].join(""),
  });

  const graph = new StateGraph(MessagesAnnotation)
    .addNode("travel_advisor", travelAdvisor, {
      ends: ["sightseeing_advisor", "hotel_advisor", "__end__"],
    })
    .addNode("sightseeing_advisor", sightseeingAdvisor, {
      ends: ["travel_advisor", "hotel_advisor", "__end__"],
    })
    .addNode("hotel_advisor", hotelAdvisor, {
      ends: ["travel_advisor", "sightseeing_advisor", "__end__"],
    })
    .addEdge("__start__", "travel_advisor")
    .compile();

  // prettier-ignore
  const buffer = (await (await graph.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  await fs.writeFile("./diagram.png", Buffer.from(await buffer));

  /* --------------------------------- stream 1 --------------------------------- */
  let messages = [
    {
      role: "user",
      content: "i wanna go somewhere warm in the caribbean",
    },
  ];

  const simpleStream = await graph.stream({
    messages,
  });

  RESULT.push(messages);

  for await (const chunk of simpleStream) {
    console.log(chunk);
    RESULT.push(chunk);
  }

  /* -------------------------------- stream 2 -------------------------------- */

  messages = [
    {
      role: "user",
      content:
        "i wanna go somewhere warm in the caribbean. pick one destination, give me some things to do and hotel recommendations",
    },
  ];

  const recommendationStream = await graph.stream({
    messages,
  });

  RESULT.push(messages);

  for await (const chunk of recommendationStream) {
    console.log(chunk);
    RESULT.push(chunk);
  }

  /* --------------------------------- result --------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT.json", JSON.stringify(RESULT, null, 2), "utf8");
})();
