# LangGraphJS > How-to Guides > How to use the prebuilt ReAct agent

This project is based on the [How to use the prebuilt ReAct agent](https://langchain-ai.github.io/langgraphjs/how-tos/create-react-agent/)

In this how-to we'll create a simple ReAct agent app that can check the weather. The app consists of an agent (LLM) and tools. As we interact with the app, we will first call the agent (LLM) to decide if we should use tools. Then we will run a loop:

- If the agent said to take an action (i.e. call tool), we'll run the tools and pass the results back to the agent
- If the agent did not ask to run tools, we will finish (respond to the user)
