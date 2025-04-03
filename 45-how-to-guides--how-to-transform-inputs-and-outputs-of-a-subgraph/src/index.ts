import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import * as fs from "fs/promises";

(async () => {
  let RESULT: (object | string)[] = [];

  /* ---------------------------- Define grandchild --------------------------- */

  const GrandChildAnnotation = Annotation.Root({
    myGrandchildKey: Annotation<string>,
  });

  const grandchild1 = (state: typeof GrandChildAnnotation.State) => {
    return {
      myGrandchildKey: state.myGrandchildKey + ", how are you",
    };
  };

  const grandchild = new StateGraph(GrandChildAnnotation)
    .addNode("grandchild1", grandchild1)
    .addEdge(START, "grandchild1");

  const grandchildGraph = grandchild.compile();

  const resultGrandchild = await grandchildGraph.invoke({
    myGrandchildKey: "hi Bob",
  });
  RESULT.push(resultGrandchild);

  /* ------------------------------ Define child ------------------------------ */

  const ChildAnnotation = Annotation.Root({
    myChildKey: Annotation<string>,
  });

  const callGrandchildGraph = async (state: typeof ChildAnnotation.State) => {
    const grandchildGraphInput = { myGrandchildKey: state.myChildKey };
    const grandchildGraphOutput = await grandchildGraph.invoke(
      grandchildGraphInput
    );
    return {
      myChildKey: grandchildGraphOutput.myGrandchildKey + " today?",
    };
  };

  const child = new StateGraph(ChildAnnotation)
    .addNode("child1", callGrandchildGraph)
    .addEdge(START, "child1");

  const childGraph = child.compile();

  const resultChild = await childGraph.invoke({ myChildKey: "hi Bob" });
  RESULT.push(resultChild);

  /* ------------------------------ Define parent ----------------------------- */

  const ParentAnnotation = Annotation.Root({
    myKey: Annotation<string>,
  });

  const parent1 = (state: typeof ParentAnnotation.State) => {
    return { myKey: "hi " + state.myKey };
  };

  const parent2 = (state: typeof ParentAnnotation.State) => {
    return { myKey: state.myKey + " bye!" };
  };

  const callChildGraph = async (state: typeof ParentAnnotation.State) => {
    const childGraphInput = { myChildKey: state.myKey };
    const childGraphOutput = await childGraph.invoke(childGraphInput);
    return { myKey: childGraphOutput.myChildKey };
  };

  const parent = new StateGraph(ParentAnnotation)
    .addNode("parent1", parent1)
    .addNode("child", callChildGraph)
    .addNode("parent2", parent2)
    .addEdge(START, "parent1")
    .addEdge("parent1", "child")
    .addEdge("child", "parent2")
    .addEdge("parent2", END);

  const parentGraph = parent.compile();

  const resultParent = await parentGraph.invoke({ myKey: "Bob" });
  RESULT.push(resultParent);

  /* -------------------------------------------------------------------------- */
  /*                                   Result                                   */
  /* -------------------------------------------------------------------------- */

  // prettier-ignore
  fs.writeFile("RESULT.json", JSON.stringify(RESULT, null, 2), "utf8");
})();
