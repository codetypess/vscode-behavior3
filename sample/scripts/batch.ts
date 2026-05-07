import type { BuildEnv, TreeData, NodeData } from "vscode-behavior3/build";

@behavior3.build
export class BatchFix {
  constructor(private readonly env: BuildEnv) {}

  onProcessTree(tree: TreeData, filePath: string, errors: string[]) {
    tree.name = this.env.path.basenameWithoutExt(filePath);
    return tree;
  }

  onProcessNode(node: NodeData, errors: string[]) {
    if (node.name === "Wait" && node.args?.time === 0) {
      errors.push("Wait.time must be > 0");
    }
    return node;
  }

  onComplete(status: "success" | "failure") {
    this.env.logger.info(`batch ${status}`);
  }
}
