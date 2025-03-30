# LangGraphJS > How-to Guides > How to pass runtime values to tools

This project is based on the [How to pass runtime values to tools](https://langchain-ai.github.io/langgraphjs/how-tos/pass-run-time-values-to-tools/)

This guide shows how to define tools that depend on dynamically defined variables. These values are provided by your program, not by the LLM.

Tools can access the `config.configurable` field for values like user IDs that are known when a graph is initially executed, as well as managed values from the `store` for persistence across threads.

However, it can be convenient to access intermediate runtime values which are not known ahead of time, but are progressively generated as a graph executes, such as the current graph state. This guide will cover two techniques for this: The `getCurrentTaskInput` utility function, and closures.
