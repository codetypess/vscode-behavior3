import type { NodeDef } from "behavior3";
import type { NodeData, TreeData } from "./b3type";

export type NodeArg = Exclude<NodeDef["args"], undefined>[number];
export type NodeInputSlot = Exclude<Exclude<NodeDef["input"], undefined>[number], string>;
export type NodeOutputSlot = Exclude<Exclude<NodeDef["output"], undefined>[number], string>;
export type NodeFieldKind = "arg" | "input" | "output";

export type NodeSlotField = {
    name: string;
    label: string;
    required: boolean;
    variadic: boolean;
    checker?: string;
    visible?: string;
};

export type BuildLogger = {
    log: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
};

export type FsLike = {
    readFileSync(path: string, encoding: "utf8" | "utf-8"): string;
    writeFileSync(path: string, data: string, encoding?: "utf8" | "utf-8"): void;
    readdirSync(path: string): string[];
    readdirSync(
        path: string,
        options: { encoding: "utf8" | "utf-8"; recursive?: boolean }
    ): string[];
    statSync(path: string): { mtimeMs: number; isFile(): boolean };
    mkdirSync(path: string, options?: { recursive?: boolean }): unknown;
    copyFileSync(source: string, destination: string): void;
    unlinkSync(path: string): void;
};

export type PathLike = {
    [key: string]: unknown;
    basename(path: string, suffix?: string): string;
    basenameWithoutExt(path: string): string;
    dirname(path: string): string;
    extname(path: string): string;
    isAbsolute(path: string): boolean;
    join(...paths: string[]): string;
    lsdir(path: string, recursive?: boolean): string[];
    normalize(path: string): string;
    posixPath(path: string): string;
    relative(from: string, to: string): string;
    resolve(...paths: string[]): string;
};

export type BuildEnv = {
    fs: FsLike;
    path: PathLike;
    workdir: string;
    nodeDefs: ReadonlyMap<string, NodeDef>;
    logger: BuildLogger;
};

export type NodeFieldCheckResult = string | string[] | null | undefined;
export type NodeFieldVisibleResult = boolean | null | undefined;

type NodeFieldBaseContext = {
    node: NodeData;
    tree: TreeData;
    nodeDef: NodeDef;
    fieldKind: NodeFieldKind;
    fieldName: string;
    fieldIndex?: number;
    treePath: string;
    env: BuildEnv;
};

export type NodeFieldCheckContext =
    | (NodeFieldBaseContext & {
          fieldKind: "arg";
          arg: NodeArg;
      })
    | (NodeFieldBaseContext & {
          fieldKind: "input";
          slot: NodeInputSlot;
          slotField: NodeSlotField;
          fieldIndex: number;
      })
    | (NodeFieldBaseContext & {
          fieldKind: "output";
          slot: NodeOutputSlot;
          slotField: NodeSlotField;
          fieldIndex: number;
      });

export type NodeFieldVisibleContext = NodeFieldCheckContext;

export interface NodeFieldChecker {
    validate(value: unknown, ctx: NodeFieldCheckContext): NodeFieldCheckResult;
}

export interface NodeFieldVisible {
    visible(value: unknown, ctx: NodeFieldVisibleContext): NodeFieldVisibleResult;
}

export type BuildScript = {
    onProcessTree?: (tree: TreeData, path: string, errors: string[]) => TreeData | null;
    onProcessNode?: (node: NodeData, errors: string[]) => NodeData | null;
    onWriteFile?: (path: string, tree: TreeData) => void;
    onComplete?: (status: "success" | "failure") => void;
};

export type BatchScript = BuildScript & {
    shouldUpgradeTree?: (path: string, tree: TreeData) => boolean;
};

export type BuildHookClass<T extends BuildScript = BuildScript> = new (...args: any[]) => T;
export type BatchHookClass<T extends BatchScript = BatchScript> = new (...args: any[]) => T;
export type NodeFieldCheckerClass<T extends NodeFieldChecker = NodeFieldChecker> = new (
    ...args: any[]
) => T;
export type NodeFieldVisibleClass<T extends NodeFieldVisible = NodeFieldVisible> = new (
    ...args: any[]
) => T;

export type BuildDecorator = {
    <T extends BuildHookClass>(target: T): T | void;
    <T extends BuildHookClass>(target: T, context: ClassDecoratorContext<T>): T | void;
};

export type BatchDecorator = {
    <T extends BatchHookClass>(target: T): T | void;
    <T extends BatchHookClass>(target: T, context: ClassDecoratorContext<T>): T | void;
};

export type CheckDecorator = {
    <T extends NodeFieldCheckerClass>(target: T): T | void;
    <T extends NodeFieldCheckerClass>(target: T, context: ClassDecoratorContext<T>): T | void;
    (name?: string): <T extends NodeFieldCheckerClass>(target: T) => T | void;
};

export type VisibleDecorator = {
    <T extends NodeFieldVisibleClass>(target: T): T | void;
    <T extends NodeFieldVisibleClass>(target: T, context: ClassDecoratorContext<T>): T | void;
    (name?: string): <T extends NodeFieldVisibleClass>(target: T) => T | void;
};

export type BuildRuntime = {
    build: BuildDecorator;
    batch: BatchDecorator;
    check: CheckDecorator;
    visible: VisibleDecorator;
};

export declare class BuildHook implements BuildScript {
    constructor(env: BuildEnv);
    onProcessTree?(tree: TreeData, path: string, errors: string[]): TreeData | null;
    onProcessNode?(node: NodeData, errors: string[]): NodeData | null;
    onWriteFile?(path: string, tree: TreeData): void;
    onComplete?(status: "success" | "failure"): void;
}

export declare class BatchHook implements BatchScript {
    constructor(env: BuildEnv);
    shouldUpgradeTree?(path: string, tree: TreeData): boolean;
    onProcessTree?(tree: TreeData, path: string, errors: string[]): TreeData | null;
    onProcessNode?(node: NodeData, errors: string[]): NodeData | null;
    onWriteFile?(path: string, tree: TreeData): void;
    onComplete?(status: "success" | "failure"): void;
}

export declare class Hook extends BuildHook {}
