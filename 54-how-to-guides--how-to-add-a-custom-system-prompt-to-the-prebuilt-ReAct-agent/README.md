# LangGraphJS > How-to Guides > How to add a custom system prompt to the prebuilt ReAct agent

This project is based on the [How to add a custom system prompt to the prebuilt ReAct agent](https://langchain-ai.github.io/langgraphjs/how-tos/react-system-prompt/)

This tutorial will show how to add a custom system prompt to the prebuilt ReAct agent

You can add a custom system prompt by passing a string to the stateModifier param.

```ts
const agent = createReactAgent({ llm: model, tools: [getWeather], stateModifier: prompt });

```
