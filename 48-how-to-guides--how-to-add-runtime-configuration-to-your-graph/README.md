# LangGraphJS > How-to Guides > How to add runtime configuration to your graph

This project is based on the [How to add runtime configuration to your graph](https://langchain-ai.github.io/langgraphjs/how-tos/configuration/)

Once you've created an app in LangGraph, you likely will want to permit configuration at runtime.

For instance, you may want to let the LLM or prompt be selected dynamically, configure a user's user_id to enforce row-level security, etc.

In LangGraph, configuration and other "out-of-band" communication is done via the RunnableConfig, which is always the second positional arg when invoking your application.

Below, we walk through an example of letting you configure a user ID and pick which model to use.
