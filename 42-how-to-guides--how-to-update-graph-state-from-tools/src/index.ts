import { tool } from "@langchain/core/tools";
import { Annotation, Command, MessagesAnnotation } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import * as fs from "fs/promises";
import { z } from "zod";

(async () => {
  let RESULT: (object | string)[] = [];

  /* -------------------------------- User info -------------------------------- */
  const USER_ID_TO_USER_INFO = {
    abc123: {
      user_id: "abc123",
      name: "Bob Dylan",
      location: "New York, NY",
    },
    zyx987: {
      user_id: "zyx987",
      name: "Taylor Swift",
      location: "Beverly Hills, CA",
    },
  };

  /* ---------------------------------- state --------------------------------- */

  const StateAnnotation = Annotation.Root({
    ...MessagesAnnotation.spec,
    lastName: Annotation<string>,
    userInfo: Annotation<Record<string, string>>,
  });

  /* ---------------------------------- tools --------------------------------- */

  const lookupUserInfo = tool(
    async (_, config) => {
      const userId = config.configurable?.user_id as string;
      if (userId === undefined) {
        throw new Error("Please provide a user id in config.configurable");
      }
      if (!(userId in USER_ID_TO_USER_INFO)) {
        throw new Error(`User "${userId}" not found`);
      }
      const toolCallId = (config as any).toolCall?.id;
      return new Command({
        update: {
          userInfo:
            USER_ID_TO_USER_INFO[userId as keyof typeof USER_ID_TO_USER_INFO],
          messages: [
            {
              role: "tool",
              content: "Successfully looked up user information",
              tool_call_id: toolCallId,
            },
          ],
        },
      });
    },
    {
      name: "lookup_user_info",
      description:
        "Always use this to look up information about the user to better assist them with their questions.",
      schema: z.object({}),
    }
  );

  const stateModifier = (state: typeof MessagesAnnotation.State) => {
    const userInfo = (state as any).userInfo;
    if (userInfo == null) {
      return state.messages;
    }
    const systemMessage = `User name is ${userInfo.name}. User lives in ${userInfo.location}`;
    return [
      {
        role: "system",
        content: systemMessage,
      },
      ...state.messages,
    ];
  };

  /* ---------------------------------- graph --------------------------------- */

  const model = new ChatOpenAI({
    model: "gpt-4o",
  });

  const agent = createReactAgent({
    llm: model,
    tools: [lookupUserInfo],
    stateSchema: StateAnnotation,
    prompt: stateModifier,
  });

  /* --------------------------------- stream --------------------------------- */
  const stream = await agent.stream(
    {
      messages: [
        {
          role: "user",
          content: "hi, what should i do this weekend?",
        },
      ],
    },
    {
      // provide user ID in the config
      configurable: { user_id: "abc123" },
    }
  );

  for await (const chunk of stream) {
    console.log(chunk);
    RESULT.push(chunk);
  }

  const taylorStream = await agent.stream(
    {
      messages: [
        {
          role: "user",
          content: "hi, what should i do this weekend?",
        },
      ],
    },
    {
      // provide user ID in the config
      configurable: { user_id: "zyx987" },
    }
  );

  for await (const chunk of taylorStream) {
    console.log(chunk);
    RESULT.push(chunk);
  }

  /* --------------------------------- Result --------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT.json",JSON.stringify(RESULT, null, 2),"utf8");
})();
