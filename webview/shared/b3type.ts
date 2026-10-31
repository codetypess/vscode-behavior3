import type { NodeDef as Behavior3NodeDef } from "behavior3";

/** Editor node definition. Adds behavior3 2.0 fields the published 1.x typings do not have yet. */
export interface NodeDef<GroupType extends string = string> extends Behavior3NodeDef<GroupType> {
    /** Composite whose left-to-right order is priority, so children may use `lower`/`both` aborts. */
    preemptive?: boolean;
}
export type NodeType = NodeDef["type"] | "Other" | "Error";
export type NodeArg = Exclude<NodeDef["args"], undefined>[number];

export const DOCUMENT_VERSION = "2.8.0";

/** When a node's conditions are re-checked after entering it (behavior3 2.0 `abort`). */
export const ABORT_MODES = ["none", "self", "lower", "both"] as const;
export type AbortMode = (typeof ABORT_MODES)[number];
export const DEFAULT_ABORT_MODE: AbortMode = "none";

export type ConditionCustom = Record<string, string | number | boolean | object>;

/** One entry of a node's `conditions`. `root` is a condition tree, not a child of the host. */
export interface ConditionData<TNode> {
    abort: AbortMode;
    /** Editor-defined data; the runtime ignores it. */
    custom?: ConditionCustom;
    root: TNode;
}

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
    /** Condition trees checked before and while running this node. Not members of `children`. */
    conditions?: ConditionData<NodeData>[];

    // Stable node identity, for overrides
    uuid: string;

    // for runtime
    $mtime?: number;
    $size?: number[];
    $status?: number;
}

export interface VarDecl {
    name: string;
    desc: string;
}

export interface TreeVariables {
    imports: string[];
    locals: VarDecl[];
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
    variables: TreeVariables;
    custom: Record<string, string | number | boolean | object>;
    root: NodeData;

    overrides: {
        [key: string]: Pick<
            NodeData,
            "desc" | "input" | "output" | "args" | "debug" | "disabled" | "conditions"
        >;
    };
}

export const keyWords = ["true", "false", "null", "undefined", "NaN", "Infinity"];

export const isIntType = (type: string) => type.startsWith("int");
export const isFloatType = (type: string) => type.startsWith("float");
export const isStringType = (type: string) => type.startsWith("string");
export const isBoolType = (type: string) => type.startsWith("bool");
export const isExprType = (type: string) => type.startsWith("expr");
export const isJsonType = (type: string) => type.startsWith("json");
export const hasArgOptions = (arg: NodeArg) => arg.options !== undefined;

/** `.b3-workspace` file shape. Extension build only reads `settings`; `files` is optional (desktop may still use it). */
export interface WorkspaceModel {
    settings: {
        allowNewFunction?: boolean;
        checkExpr?: boolean;
        buildScript?: string;
        checkScripts?: string[];
        /** Override default node-type colors. Keys: "Composite" | "Decorator" | "Condition" | "Action" | "Other" | "Error" */
        nodeColors?: Record<string, string>;
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
