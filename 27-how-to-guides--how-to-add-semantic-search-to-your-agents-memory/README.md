# LangGraphJS > How-to Guides > How to add semantic search to your agent's memory

This project is based on the [How to add semantic search to your agent's memory](https://langchain-ai.github.io/langgraphjs/how-tos/semantic-search/)

This guide shows how to enable semantic search in your agent's memory store. This lets your agent search for items in the long-term memory store by semantic similarity.

## The anatomy of a memory

let's look at how memories are structured, and how to store them:

```ts
let namespace = ["user_123", "memories"];
let memoryKey = "favorite_food";
let memoryValue = { text: "I love pizza" };

await store.put(namespace, memoryKey, memoryValue);
```

As you can see, memories are composed of a namespace, a key, and a value.

- Namespaces: are multi-dimensional values (arrays of strings) that allow you to segment memory according to the needs of your application. In this case, we're segmenting memories by user by using a User ID ("user_123") as the first dimension of our namespace array.

- Keys: are arbitrary strings that identify the memory within the namespace. If you write to the same key in the same namespace multiple times, you'll overwrite the memory that was stored under that key.

- Values: are objects that represent the actual memory being stored. These can be any object, so long as its serializable. You can structure these objects according to the needs of your application.

## Simple memory retrieval

```ts
await store.put(["user_123", "memories"], "italian_food", {
  text: "I prefer Italian food",
});
await store.put(["user_123", "memories"], "spicy_food", {
  text: "I don't like spicy food",
});
await store.put(["user_123", "memories"], "occupation", {
  text: "I am an airline pilot",
});

// That occupation is too lofty - let's overwrite
// it with something more... down-to-earth
await store.put(["user_123", "memories"], "occupation", {
  text: "I am a tunnel engineer",
});

// now let's check that our occupation memory was overwritten
const occupation = await store.get(["user_123", "memories"], "occupation");
console.log(occupation.value.text);
// output: I am a tunnel engineer
```

## Searching memories with natural language

Now that we've seen how to store and retrieve memories by namespace and key, let's look at how memories are retrieved using semantic search.

```ts
const memories = await store.search(["user_123", "memories"], {
  query: "What is my occupation?",
  limit: 3,
});

for (const memory of memories) {
  console.log(`Memory: ${memory.value.text} (similarity: ${memory.score})`);
}

// output
// Memory: I am a tunnel engineer (similarity: 0.3070681445327329)
// Memory: I prefer Italian food (similarity: 0.1435366180543232)
// Memory: I love pizza (similarity: 0.10650935500808985)
```

## Multi-vector indexing

You can store and search different aspects of memories separately to improve recall or to omit certain fields from the semantic indexing process.

```ts
import { InMemoryStore } from "@langchain/langgraph";

// Configure store to embed both memory content and emotional context
const multiVectorStore = new InMemoryStore({
  index: {
    embeddings: embeddings,
    dims: 1536,
    fields: ["memory", "emotional_context"],
  },
});

// Store memories with different content/emotion pairs
await multiVectorStore.put(["user_123", "memories"], "mem1", {
  memory: "Had pizza with friends at Mario's",
  emotional_context: "felt happy and connected",
  this_isnt_indexed: "I prefer ravioli though",
});
await multiVectorStore.put(["user_123", "memories"], "mem2", {
  memory: "Ate alone at home",
  emotional_context: "felt a bit lonely",
  this_isnt_indexed: "I like pie",
});

// Search focusing on emotional state - matches mem2
const results = await multiVectorStore.search(["user_123", "memories"], {
  query: "times they felt isolated",
  limit: 1,
});

console.log("Expect mem 2");

for (const r of results) {
  console.log(`Item: ${r.key}; Score(${r.score})`);
  console.log(`Memory: ${r.value.memory}`);
  console.log(`Emotion: ${r.value.emotional_context}`);
}

// Expect mem 2
// Item: mem2; Score(0.58961641225287)
// Memory: Ate alone at home
// Emotion: felt a bit lonely
```
