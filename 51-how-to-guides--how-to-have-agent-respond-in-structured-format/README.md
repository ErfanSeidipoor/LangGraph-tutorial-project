# LangGraphJS > How-to Guides > How to have agent respond in structured format

This project is based on the [How to have agent respond in structured format](https://langchain-ai.github.io/langgraphjs/how-tos/respond-in-format/)

The typical ReAct agent prompts the LLM to respond in 1 of two formats: a function call (~ JSON) to use a tool, or conversational text to respond to the user.

If your agent is connected to a structured (or even generative) UI, or if it is communicating with another agent or software process, you may want it to resopnd in a specific structured format.

In this example we will build a conversational ReAct agent that responds in a specific format. We will do this by using tool calling. This is useful when you want to enforce that an agent's response is in a specific format. In this example, we will ask it respond as if it were a weatherman, returning the temperature and additional info in separate, machine-readable fields.
