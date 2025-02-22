import { BaseMessage } from "@langchain/core/messages";
import { ChatPromptValue } from "@langchain/core/prompt_values";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { StructuredTool } from "@langchain/core/tools";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import { Annotation } from "@langchain/langgraph";
import { ChatOllama } from "@langchain/ollama";

(async () => {
  const WORKFLOW: any[] = [];

  async function createAgent({
    llm,
    tools,
    systemMessage,
  }: {
    llm: ChatOllama;
    tools: StructuredTool[];
    systemMessage: string;
  }) {
    const toolNames = tools.map((tool) => tool.name).join(", ");
    const formattedTools = tools.map((tool) => convertToOpenAITool(tool));

    let prompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        "You are a helpful AI assistant, collaborating with other assistants." +
          " Use the provided tools to progress towards answering the question." +
          " If you are unable to fully answer, that's OK, another assistant with different tools " +
          " will help where you left off. Execute what you can to make progress." +
          " If you or any of the other assistants have the final answer or deliverable," +
          " prefix your response with FINAL ANSWER so the team knows to stop." +
          " You have access to the following tools: {tool_names}.\n{system_message}",
      ],
      new MessagesPlaceholder("messages"),
    ]);

    prompt = await prompt.partial({
      system_message: systemMessage,
      tool_names: toolNames,
    });

    return prompt.pipe(llm.bind({ tools: formattedTools }));
  }

  const agentState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
      reducer: (x, y) => x.concat(y),
    }),
    sender: Annotation<string>({
      reducer: (x, y) => y ?? x ?? "user",
      default: () => "user",
    }),
  });
})();
