import { task, entrypoint } from "@langchain/langgraph";
import { ChatOllama } from "@langchain/ollama";

(async () => {
  const llm = new ChatOllama({
    model: "llama3.2",
  });

  const generateJoke = task("generateJoke", async (topic: string) => {
    const msg = await llm.invoke(`Write a short joke about ${topic}`);
    return msg.content;
  });

  const checkPunchline = task("checkPunchline", async (joke: string) => {
    if (joke?.includes("?") || joke?.includes("!")) {
      return "Pass";
    }
    return "False";
  });

  const improveJoke = task("improveJoke", async (joke: string) => {
    const message = await llm.invoke(
      `Make this joke funnier by adding wordplay: ${joke}`
    );
    return message.content;
  });

  const polishJoke = task("polishJoke", async (improvedJoke: string) => {
    const message = await llm.invoke(
      `Add a surprising twist to this joke: ${improvedJoke}`
    );
    return message.content;
  });

  const workflow = entrypoint("jokeMaker", async (topic: string) => {
    const originalJoke = await generateJoke(topic);

    if ((await checkPunchline(originalJoke as string)) !== "Pass") {
      return originalJoke;
    }
    const improvedJoke = await improveJoke(originalJoke as string);

    const polishedJoke = await polishJoke(improvedJoke as string);

    return polishedJoke;
  });

  const stream = await workflow.stream("cats", {
    streamMode: "updates",
  });

  for await (const step of stream) {
    console.log(step);
  }
})();
