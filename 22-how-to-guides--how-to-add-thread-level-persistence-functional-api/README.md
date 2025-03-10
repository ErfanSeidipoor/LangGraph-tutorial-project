# LangGraphJS > How-to Guides > How to add thread-level persistence (functional API)

This project is based on the [How to add thread-level persistence (functional API)](https://langchain-ai.github.io/langgraphjs/how-tos/persistence-functional/)
Many AI applications need memory to share context across multiple interactions on the same thread (e.g., multiple turns of a conversation). In LangGraph functional API, this kind of memory can be added to any entrypoint() workflow using thread-level persistence.

When creating a LangGraph workflow, you can set it up to persist its results by using a checkpointer:

1. Create an instance of a checkpointer:

```ts
import { MemorySaver } from "@langchain/langgraph";

const checkpointer = new MemorySaver();
```

2. Pass checkpointer instance to the entrypoint() wrapper function:

```ts
import { entrypoint } from "@langchain/langgraph";
const workflow = entrypoint({
  name: "workflow",
  checkpointer,
}, async (inputs) => {
  ...
});
```

3. Retrieve previous state from the prior execution within the workflow:

```ts
import { entrypoint, getPreviousState } from "@langchain/langgraph";

const workflow = entrypoint({
  name: "workflow",
  checkpointer,
}, async (inputs) => {
  const previous = getPreviousState();
  const result = doSomething(previous, inputs);
  ...
});
```

4. Optionally choose which values will be returned from the workflow and which will be saved by the checkpointer as previous:

```ts
import { entrypoint, getPreviousState } from "@langchain/langgraph";

const workflow = entrypoint({
  name: "workflow",
  checkpointer,
}, async (inputs) => {
  const previous = getPreviousState();
  const result = doSomething(previous, inputs);
  ...
  return entrypoint.final({
    value: result,
    save: combineState(inputs, result),
  });
});
```
