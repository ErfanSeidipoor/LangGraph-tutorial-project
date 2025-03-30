# LangGraphJS > How-to Guides > How to update graph state from tools

This project is based on the [How to update graph state from tools](https://langchain-ai.github.io/langgraphjs/how-tos/update-state-from-tools/)

A common use case is updating graph state from inside a tool. For example, in a customer support application you might want to look up customer account number or ID in the beginning of the conversation. To update the graph state from the tool, you can return a `Command` object from the tool:

```ts
import { tool } from "@langchain/core/tools";

const lookupUserInfo = tool(async (input, config) => {
  const userInfo = getUserInfo(config);
  return new Command({
    // update state keys
    update: {
      user_info: userInfo,
      messages: [
        new ToolMessage({
          content: "Successfully looked up user information",
          tool_call_id: config.toolCall.id,
        }),
      ],
    },
  });
}, {
  name: "lookup_user_info",
  description: "Use this to look up user information to better assist them with their questions.",
  schema: z.object(...)
});

```
