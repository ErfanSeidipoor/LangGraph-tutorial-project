import {
  Annotation,
  MessagesAnnotation,
  NodeInterrupt,
  StateGraph,
  MemorySaver,
} from "@langchain/langgraph";
import { ChatOllama } from "@langchain/ollama";
import * as fs from "fs";
import { z } from "zod";

(async () => {
  const model = new ChatOllama({
    model: "llama3.2",
    temperature: 0,
  });

  const StateAnnotation = Annotation.Root({
    ...MessagesAnnotation.spec,
    nextRepresentative: Annotation<
      "BILLING" | "TECHNICAL" | "RESPOND" | "REFUND"
    >,
    refundAuthorized: Annotation<boolean>,
  });

  const initialSupportNode = async (state: typeof StateAnnotation.State) => {
    const supportResponse = await model.invoke([
      {
        role: "system",
        content: `
          You are frontline support staff for LangCorp, a company that sells computers.
          Be concise in your responses.
          You can chat with customers and help them with basic questions, but if the customer is having a billing or technical problem,
          do not try to answer the question directly or gather information.
          Instead, immediately transfer them to the billing or technical team by asking the user to hold for a moment.
          Otherwise, just respond conversationally.
        `,
      },
      ...state.messages,
    ]);

    const categorizationResponse = await model
      .withStructuredOutput(
        z.object({
          nextRepresentative: z.enum(["BILLING", "TECHNICAL", "RESPOND"]),
        })
      )
      .invoke([
        {
          role: "system",
          content: `
          You are an expert customer support routing system.
          Your job is to detect whether a customer support representative is routing a user to a billing team or a technical team, or if they are just responding conversationally.
        `,
        },
        ...state.messages,
        {
          role: "user",
          content: `
          The previous conversation is an interaction between a customer support representative and a user.
          Extract whether the representative is routing the user to a billing or technical team, or whether they are just responding conversationally.
          Respond with a JSON object containing a single key called "nextRepresentative" with one of the following values:

          If they want to route the user to the billing team, respond only with the word "BILLING".
          If they want to route the user to the technical team, respond only with the word "TECHNICAL".
          Otherwise, respond only with the word "RESPOND".
        `,
        },
      ]);

    return {
      messages: [supportResponse],
      nextRepresentative: categorizationResponse.nextRepresentative,
    };
  };

  const billingSupportNode = async (state: typeof StateAnnotation.State) => {
    let trimmedHistory = state.messages;
    // Make the user's question the most recent message in the history.
    // This helps small models stay focused.
    if (trimmedHistory.at(-1)!.getType() === "ai") {
      trimmedHistory = trimmedHistory.slice(0, -1);
    }

    const billingResponse = await model.invoke([
      {
        role: "system",
        content: `
          You are an expert billing support specialist for LangCorp, a company that sells computers.
          Help the user to the best of your ability, but be concise in your responses.
          You have the ability to authorize refunds, which you can do by transferring the user to another agent who will collect the required information.
          If you do, assume the other agent has all necessary information about the customer and their order.
          You do not need to ask the user for more information.
          Help the user to the best of your ability, but be concise in your responses.
        `,
      },
      ...trimmedHistory,
    ]);

    const categorizationResponse = await model
      .withStructuredOutput(
        z.object({
          nextRepresentative: z.enum(["REFUND", "RESPOND"]),
        })
      )
      .invoke([
        {
          role: "system",
          content:
            "Your job is to detect whether a billing support representative wants to refund the user.",
        },
        {
          role: "user",
          content: `
            The following text is a response from a customer support representative.
            Extract whether they want to refund the user or not.
            Respond with a JSON object containing a single key called "nextRepresentative" with one of the following values:

            If they want to refund the user, respond only with the word "REFUND".
            Otherwise, respond only with the word "RESPOND".

            Here is the text:

            <text>
            ${billingResponse.content}
            </text>.
          `,
        },
      ]);

    return {
      messages: [billingResponse],
      nextRepresentative: categorizationResponse.nextRepresentative,
    };
  };

  const technicalSupportNode = async (state: typeof StateAnnotation.State) => {
    let trimmedHistory = state.messages;
    // Make the user's question the most recent message in the history.
    // This helps small models stay focused.
    if (trimmedHistory.at(-1)!.getType() === "ai") {
      trimmedHistory = trimmedHistory.slice(0, -1);
    }

    const response = await model.invoke([
      {
        role: "system",
        content: `
          You are an expert at diagnosing technical computer issues. You work for a company called LangCorp that sells computers.
          Help the user to the best of your ability, but be concise in your responses.
        `,
      },
      ...trimmedHistory,
    ]);

    return {
      messages: response,
    };
  };

  const handleRefundNode = async (state: typeof StateAnnotation.State) => {
    if (!state.refundAuthorized) {
      console.log("--- HUMAN AUTHORIZATION REQUIRED FOR REFUND ---");
      throw new NodeInterrupt("Human authorization required.");
    }
    return {
      messages: {
        role: "assistant",
        content: "Refund processed!",
      },
    };
  };

  const graph = new StateGraph(StateAnnotation)
    .addNode("initialSupportNode", initialSupportNode)
    .addNode("billingSupportNode", billingSupportNode)
    .addNode("technicalSupportNode", technicalSupportNode)
    .addNode("handleRefundNode", handleRefundNode)

    .addEdge("__start__", "initialSupportNode")
    .addConditionalEdges(
      "initialSupportNode",
      (state) => state.nextRepresentative,
      {
        BILLING: "billingSupportNode",
        TECHNICAL: "technicalSupportNode",
        RESPOND: "__end__",
      }
    )
    .addEdge("technicalSupportNode", "__end__")
    .addConditionalEdges(
      "billingSupportNode",
      (state) => state.nextRepresentative,
      {
        REFUND: "handleRefundNode",
        RESPOND: "__end__",
      }
    )
    .addEdge("handleRefundNode", "__end__")
    .compile({
      checkpointer: new MemorySaver(),
    });

  // prettier-ignore
  const buffer = (await (await graph.getGraphAsync()).drawMermaidPng({})).arrayBuffer();
  fs.writeFileSync("./index.png", Buffer.from(await buffer));

  const stream = await graph.stream(
    {
      messages: [
        {
          role: "user",
          content:
            "I've changed my mind and I want a refund for order #182818!",
        },
      ],
    },
    {
      configurable: {
        thread_id: "refund_testing_id",
      },
    }
  );

  for await (const value of stream) {
    console.log("---STEP---");
    console.log(value);
    console.log("---END STEP---");
  }

  let currentState = await graph.getState({
    configurable: { thread_id: "refund_testing_id" },
  });

  console.log("CURRENT TASKS", JSON.stringify(currentState.tasks, null, 2));

  // prettier-ignore
  fs.writeFileSync("result1.json",JSON.stringify({ currentState }, null, 2),"utf8");

  await graph.updateState(
    { configurable: { thread_id: "refund_testing_id" } },
    {
      refundAuthorized: true,
    }
  );

  const resumedStream = await graph.stream(null, {
    configurable: { thread_id: "refund_testing_id" },
  });

  for await (const value of resumedStream) {
    console.log("---STEP---");
    console.log(value);
    console.log("---END STEP---");
  }

  currentState = await graph.getState({
    configurable: { thread_id: "refund_testing_id" },
  });

  // prettier-ignore
  fs.writeFileSync("result2.json",JSON.stringify({ currentState }, null, 2),"utf8");
})();
