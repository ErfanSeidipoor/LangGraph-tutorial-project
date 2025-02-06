# How to use prompting to improve results

This project is based on the [How to use prompting to improve results](https://js.langchain.com/docs/how_to/sql_prompting/)

This project demonstrates how to use prompting to improve results in SQL query generation using the LangChain library. The example code is based on the official LangChain documentation. The project consists of a single file, `index.ts`, which imports various modules from the LangChain library and defines an array of examples for generating SQL queries.

### src/index.ts

This file contains the main entry point of the project. It:

- Imports necessary modules from the LangChain library.
- Defines an array of examples for generating SQL queries.
- Creates a SQLite database connection using TypeORM.
- Generates syntactically correct SQL queries based on user input using the `FewShotPromptTemplate`.
- Formats the query using the `prompt` template.
- Invokes the query using the `createSqlQueryChain`.
