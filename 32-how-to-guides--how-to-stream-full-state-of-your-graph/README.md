# LangGraphJS > How-to Guides > How to stream full state of your graph

This project is based on the [How to stream full state of your graph](https://langchain-ai.github.io/langgraphjs/how-tos/stream-values/)

LangGraph supports multiple streaming modes. The main ones are:

- `values`: This streaming mode streams back values of the graph. This is the full state of the graph after each node is called.
- `updates`: This streaming mode streams back updates to the graph. This is the update to the state of the graph after each node is called.
