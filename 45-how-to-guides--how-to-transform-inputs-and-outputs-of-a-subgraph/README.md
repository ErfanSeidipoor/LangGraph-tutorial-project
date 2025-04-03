# LangGraphJS > How-to Guides > How to transform inputs and outputs of a subgraph

This project is based on the [How to transform inputs and outputs of a subgraph](https://langchain-ai.github.io/langgraphjs/how-tos/subgraph-transform-state/)

It's possible that your subgraph state is completely independent from the parent graph state, i.e. there are no overlapping channels (keys) between the two. For example, you might have a supervisor agent that needs to produce a report with a help of multiple ReAct agents. ReAct agent subgraphs might keep track of a list of messages whereas the supervisor only needs user input and final report in its state, and doesn't need to keep track of messages.

In such cases you need to transform the inputs to the subgraph before calling it and then transform its outputs before returning. This guide shows how to do that.
