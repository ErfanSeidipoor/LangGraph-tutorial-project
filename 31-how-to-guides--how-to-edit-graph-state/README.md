# LangGraphJS > How-to Guides > How to edit graph state

This project is based on the [How to edit graph state](https://langchain-ai.github.io/langgraphjs/how-tos/edit-graph-state/)

Human-in-the-loop (HIL) interactions are crucial for agentic systems. Manually updating the graph state a common HIL interaction pattern, allowing the human to edit actions (e.g., what tool is being called or how it is being called).

We can implement this in LangGraph using a breakpoint: breakpoints allow us to interrupt graph execution before a specific step. At this breakpoint, we can manually update the graph state and then resume from that spot to continue.

![update state](./update-state.png)

![basic](./diagram.png)
