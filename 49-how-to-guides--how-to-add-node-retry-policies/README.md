# LangGraphJS > How-to Guides > How to add node retry policies

This project is based on the [How to add node retry policies](https://langchain-ai.github.io/langgraphjs/how-tos/node-retry-policies/)

There are many use cases where you may wish for your node to have a custom retry policy. Some examples of when you may wish to do this is if you are calling an API, querying a database, or calling an LLM, etc.

In order to configure the retry policy, you have to pass the retryPolicy parameter to the addNode function. The retryPolicy parameter takes in a RetryPolicy named tuple object. Below we instantiate a RetryPolicy object with the default parameters:

```ts
import { RetryPolicy } from "@langchain/langgraph";

const retryPolicy: RetryPolicy = {};
```
