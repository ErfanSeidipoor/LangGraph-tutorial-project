# LangGraphJS > How-to Guides > How to let agent return tool results directly

This project is based on the [How to let agent return tool results directly](https://langchain-ai.github.io/langgraphjs/how-tos/dynamically-returning-directly/)

A typical ReAct loop follows user -> assistant -> tool -> assistant ..., -> user. In some cases, you don't need to call the LLM after the tool completes, the user can view the results directly themselves.

In this example we will build a conversational ReAct agent where the LLM can optionally decide to return the result of a tool call as the final answer. This is useful in cases where you have tools that can sometimes generate responses that are acceptable as final answers, and you want to use the LLM to determine when that is the case
