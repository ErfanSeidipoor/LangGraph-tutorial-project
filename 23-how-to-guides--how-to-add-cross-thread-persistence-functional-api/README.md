# LangGraphJS > How-to Guides > How to add cross-thread persistence (functional API)

This project is based on the [How to add cross-thread persistence (functional API)](https://langchain-ai.github.io/langgraphjs/how-tos/cross-thread-persistence-functional/)
LangGraph allows you to persist data across different threads. For instance, you can store information about users (their names or preferences) in a shared (cross-thread) memory and reuse them in the new threads (e.g., new conversations).

When using the functional API, you can set it up to store and retrieve memories by using the Store interface:

1. Create an instance of a Store

```ts
import { InMemoryStore } from "@langchain/langgraph";

const store = new InMemoryStore();
```

2. Pass the store instance to the entrypoint() wrapper function. It will be passed to the workflow as config.store.

```ts
import { entrypoint } from "@langchain/langgraph";

const workflow = entrypoint({
  store,
  name: "myWorkflow",
}, async (input, config) => {
  const foo = await myTask({input, store: config.store});
  ...
});
```
