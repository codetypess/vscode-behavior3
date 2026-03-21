// Copied from original project, with NodeDef import replaced by local definition
// to avoid Node.js-specific imports in browser context.

export const VERSION = "1.9.0";

export const keyWords = ["true", "false", "null", "undefined", "NaN", "Infinity"];

/** Minimal NodeDef type used in the webview (mirrors behavior3 runtime) */
export interface NodeDefArg {
  name: string;
  type: string;
  desc?: string;
  default?: unknown;
  options?: unknown;
  optional?: boolean;
  oneof?: string;
}

export interface NodeDef {
  name: string;
  type: string;
  desc?: string;
  doc?: string;
  args?: NodeDefArg[];
  input?: string[];
  output?: string[];
  children?: number;
}

export type NodeType = "Action" | "Composite" | "Decorator" | "Condition" | "Other" | "Error";
export type NodeArg = NodeDefArg;

export const isIntType = (type: string) => type.startsWith("int");
export const isFloatType = (type: string) => type.startsWith("float");
export const isStringType = (type: string) => type.startsWith("string");
export const isBoolType = (type: string) => type.startsWith("bool");
export const isExprType = (type: string) => type.startsWith("expr") || type.startsWith("code");
export const isJsonType = (type: string) => type.startsWith("json");
export const hasArgOptions = (arg: NodeArg) => arg.options !== undefined;

export interface NodeData {
  id: string;
  name: string;
  desc?: string;
  args?: { [key: string]: unknown };
  input?: string[];
  output?: string[];
  children?: NodeData[];
  debug?: boolean;
  disabled?: boolean;
  path?: string;

  // nanoid, for override
  $id: string;

  // for runtime
  $mtime?: number;
  $size?: number[];
  $status?: number;
}

export type NodeLayout = "compact" | "normal";

export interface VarDecl {
  name: string;
  desc: string;
}

export interface GroupDecl {
  name: string;
  value: boolean;
}

export interface ImportDecl {
  path: string;
  modified?: number;
  vars: VarDecl[];
  depends: {
    path: string;
    modified: number;
  }[];
}

export interface FileVarDecl {
  import: ImportDecl[];
  subtree: ImportDecl[];
  vars: VarDecl[];
}

export interface TreeData {
  version: string;
  name: string;
  prefix: string;
  desc?: string;
  export?: boolean;
  group: string[];
  import: string[];
  vars: VarDecl[];
  custom: Record<string, string | number | boolean | object>;
  root: NodeData;

  $override: {
    [key: string]: Pick<NodeData, "desc" | "input" | "output" | "args" | "debug" | "disabled">;
  };
}

export const getNodeType = (def: NodeDef): NodeType => {
  const type = def.type.toLocaleLowerCase().toString();
  if (type.startsWith("action")) {
    return "Action";
  } else if (type.startsWith("composite")) {
    return "Composite";
  } else if (type.startsWith("decorator")) {
    return "Decorator";
  } else if (type.startsWith("condition")) {
    return "Condition";
  } else {
    return "Other";
  }
};
