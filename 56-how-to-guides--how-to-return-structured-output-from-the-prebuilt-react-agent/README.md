# LangGraphJS > How-to Guides > How to return structured output from the prebuilt ReAct agent

This project is based on the [How to return structured output from the prebuilt ReAct agent](https://langchain-ai.github.io/langgraphjs/how-tos/react-return-structured-output/)

To return structured output from the prebuilt ReAct agent you can provide a responseFormat parameter with the desired output schema to createReactAgent:

```ts
import { z } from "zod";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

const responseFormat = z.object({
  mySpecialOutput: z.string(),
});

const graph = createReactAgent({
  llm: llm,
  tools: tools,
  responseFormat: responseFormat,
});
```
