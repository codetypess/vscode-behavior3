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

export type FsEncoding =
    | "ascii"
    | "base64"
    | "base64url"
    | "binary"
    | "hex"
    | "latin1"
    | "ucs-2"
    | "ucs2"
    | "utf-8"
    | "utf16le"
    | "utf8";

export type FsFileData = string | Uint8Array;

export type FsReadFileOptions = {
    encoding?: FsEncoding | null;
    flag?: string;
};

export type FsWriteFileOptions = {
    encoding?: FsEncoding | null;
    mode?: number | string;
    flag?: string;
    flush?: boolean;
};

export type FsDirentLike = {
    name: string;
    path?: string;
    parentPath?: string;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isDirectory(): boolean;
    isFIFO(): boolean;
    isFile(): boolean;
    isSocket(): boolean;
    isSymbolicLink(): boolean;
};

export type FsStatsLike = {
    atime: Date;
    atimeMs: number;
    birthtime: Date;
    birthtimeMs: number;
    blocks: number;
    blksize: number;
    ctime: Date;
    ctimeMs: number;
    dev: number;
    gid: number;
    ino: number;
    mode: number;
    mtime: Date;
    mtimeMs: number;
    nlink: number;
    rdev: number;
    size: number;
    uid: number;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isDirectory(): boolean;
    isFIFO(): boolean;
    isFile(): boolean;
    isSocket(): boolean;
    isSymbolicLink(): boolean;
};

export type FsMkdirOptions = {
    recursive?: boolean;
    mode?: number | string;
};

export type FsReaddirOptions = {
    encoding?: FsEncoding;
    recursive?: boolean;
    withFileTypes?: false;
};

export type FsReaddirDirentOptions = {
    encoding?: FsEncoding;
    recursive?: boolean;
    withFileTypes: true;
};

export type FsMkdtempOptions = {
    encoding?: FsEncoding;
};

export type FsRmOptions = {
    force?: boolean;
    maxRetries?: number;
    recursive?: boolean;
    retryDelay?: number;
};

export type FsCpOptions = {
    dereference?: boolean;
    errorOnExist?: boolean;
    filter?: (source: string, destination: string) => boolean;
    force?: boolean;
    mode?: number;
    preserveTimestamps?: boolean;
    recursive?: boolean;
    verbatimSymlinks?: boolean;
};

export type FsLike = {
    accessSync(path: string, mode?: number): void;
    appendFileSync(path: string, data: FsFileData, options?: FsEncoding | FsWriteFileOptions): void;
    chmodSync(path: string, mode: number | string): void;
    readdirSync(path: string): string[];
    readdirSync(path: string, options: FsReaddirOptions): string[];
    readdirSync(path: string, options: FsReaddirDirentOptions): FsDirentLike[];
    readFileSync(path: string): Uint8Array;
    readFileSync(path: string, encoding: FsEncoding): string;
    readFileSync(path: string, options: FsReadFileOptions & { encoding: FsEncoding }): string;
    readFileSync(path: string, options?: FsReadFileOptions): Uint8Array;
    readlinkSync(path: string, options?: FsEncoding | { encoding?: FsEncoding }): string;
    realpathSync(path: string, options?: FsEncoding | { encoding?: FsEncoding }): string;
    writeFileSync(path: string, data: FsFileData, options?: FsEncoding | FsWriteFileOptions): void;
    copyFileSync(source: string, destination: string, mode?: number): void;
    cpSync(source: string, destination: string, options?: FsCpOptions): void;
    existsSync(path: string): boolean;
    lstatSync(path: string): FsStatsLike;
    mkdirSync(path: string, options?: FsMkdirOptions | number | string): string | undefined;
    mkdtempSync(prefix: string, options?: FsEncoding | FsMkdtempOptions): string;
    renameSync(oldPath: string, newPath: string): void;
    rmSync(path: string, options?: FsRmOptions): void;
    rmdirSync(path: string, options?: FsRmOptions): void;
    statSync(path: string): FsStatsLike;
    symlinkSync(target: string, path: string, type?: "dir" | "file" | "junction"): void;
    unlinkSync(path: string): void;
    utimesSync(path: string, atime: string | number | Date, mtime: string | number | Date): void;
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
    allowNewFunction?: boolean;
    language?: string;
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
