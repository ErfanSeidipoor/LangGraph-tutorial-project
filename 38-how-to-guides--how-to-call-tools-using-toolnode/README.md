# LangGraphJS > How-to Guides > How to call tools using ToolNode

This project is based on the [How to call tools using ToolNode](https://langchain-ai.github.io/langgraphjs/how-tos/tool-calling/)

this guide covers how to use LangGraph's prebuilt ToolNode for tool calling.

ToolNode is a LangChain Runnable that takes graph state (with a list of messages) as input and outputs state update with the result of tool calls. It is designed to work well out-of-box with LangGraph's prebuilt ReAct agent, but can also work with any StateGraph as long as its state has a messages key with an appropriate reducer (see MessagesAnnotation).
