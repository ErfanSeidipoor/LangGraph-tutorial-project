# LangGraphJS > How-to Guides > How to view and update state in subgraphs

This project is based on the [How to view and update state in subgraphs](https://langchain-ai.github.io/langgraphjs/how-tos/subgraphs-manage-state/)

Once you add persistence, you can view and update the state of the subgraph at any point in time. This enables human-in-the-loop interaction patterns such as:

- You can surface a state during an interrupt to a user to let them accept an action.
- You can rewind the subgraph to reproduce or avoid issues.
- You can modify the state to let the user better control its actions.

![Grand Parent diagram](./diagram-parent-graph.jpeg)

![Subgraph diagram](./diagram-grand-parent-graph.jpeg)
