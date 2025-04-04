# LangGraphJS > How-to Guides > How to add human-in-the-loop processes to the prebuilt ReAct agent

This project is based on the [How to add human-in-the-loop processes to the prebuilt ReAct agent](https://langchain-ai.github.io/langgraphjs/how-tos/react-human-in-the-loop/)

This tutorial will show how to add human-in-the-loop processes to the prebuilt ReAct agent.

You can add a a breakpoint before tools are called by passing interruptBefore: ["tools"] to createReactAgent. Note that you need to be using a checkpointer for this to work.
