# LangGraphJS > How-to Guides > How to use Postgres checkpointer for persistence

This project is based on the [How to use Postgres checkpointer for persistence](https://langchain-ai.github.io/langgraphjs/how-tos/cross-thread-persistence/)

When creating LangGraph agents, you can set them up so that they persist their state across executions. This allows you to do things like interact with an agent multiple times and have it remember previous interactions.

This how-to guide shows how to use Postgres as the backend for persisting checkpoint state using the @langchain/langgraph-checkpoint-postgres library and the PostgresSaver class.

For demonstration purposes we will add persistence to the pre-built create react agent.

In general, you can add a checkpointer to any custom graph that you build like this:

```ts

import { StateGraph } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

const builder = new StateGraph(...);

// ... define the graph

const checkpointer = PostgresSaver.fromConnString(...); // postgres checkpointer (see examples below)

const graph = builder.compile({ checkpointer });

```
