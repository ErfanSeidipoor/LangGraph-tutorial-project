# LangGraphJS > tutorials > Customer support chatbot with a small model

This project is based on the [Corrective RAG (CRAG)](https://langchain-ai.github.io/langgraphjs/tutorials/rag/langgraph_crag/)

Corrective-RAG (CRAG) is a recent paper that introduces an interesting approach for self-reflective RAG.

The framework grades retrieved documents relative to the question:

1- Correct documents

2- If at least one document exceeds the threshold for relevance, then it proceeds to generation

3- Before generation, it performns knowledge refinement

4- This paritions the document into "knowledge strips"

5- It grades each strip, and filters our irrelevant ones

6- Ambiguous or incorrect documents -

7- If all documents fall below the relevance threshold or if the grader is unsure, then the framework seeks an additional datasource

8- It will use web search to supplement retrieval

9- The diagrams in the paper also suggest that query re-writing is used here

![Agent Workflow](./diagram.png)
![Agent Workflow](./index.png)
