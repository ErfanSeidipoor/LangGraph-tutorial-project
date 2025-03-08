# LangGraphJS > How-to Guides > How to add cross-thread persistence to your graph

This project is based on the [How to add cross-thread persistence to your graph](https://langchain-ai.github.io/langgraphjs/how-tos/cross-thread-persistence/)

LangGraph.js also allows you to persist data across multiple threads. For instance, you can store information about users (their names or preferences) in a shared memory and reuse them in the new conversational threads. In this guide, we will show how to construct and use a graph that has a shared memory implemented using the Store interface.

![diagram](./diagram.png)
