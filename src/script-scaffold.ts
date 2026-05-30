export type ScriptScaffoldKind = "build" | "batch" | "checker";

const SCRIPT_FILE_EXTENSION_RE = /\.(ts|mts|js|mjs)$/i;
const INVALID_FILE_NAME_RE = /[\/\\:*?"<>|]/;

const DEFAULT_BASE_NAMES: Record<ScriptScaffoldKind, string> = {
    build: "build",
    batch: "batch",
    checker: "checker",
};

export function getScriptScaffoldDefaultBaseName(kind: ScriptScaffoldKind): string {
    return DEFAULT_BASE_NAMES[kind];
}

export function normalizeScriptScaffoldBaseName(value: string): string {
    return value.trim();
}

export function validateScriptScaffoldBaseName(value: string): string | null {
    const normalized = normalizeScriptScaffoldBaseName(value);
    if (!normalized) {
        return "Name cannot be empty";
    }
    if (INVALID_FILE_NAME_RE.test(normalized)) {
        return "Name contains invalid characters";
    }
    if (SCRIPT_FILE_EXTENSION_RE.test(normalized)) {
        return "Enter the name without an extension";
    }
    return null;
}

export function createScriptScaffoldFileName(baseName: string): string {
    return `${normalizeScriptScaffoldBaseName(baseName)}.ts`;
}

export function createScriptScaffoldContent(kind: ScriptScaffoldKind, baseName: string): string {
    switch (kind) {
        case "build":
            return createBuildScriptContent(baseName);
        case "batch":
            return createBatchScriptContent(baseName);
        case "checker":
            return createCheckerScriptContent(baseName);
    }
}

function createBuildScriptContent(baseName: string): string {
    const className = ensureSuffix(toPascalIdentifier(baseName), "Script");
    return [
        'import type { BuildEnv, BuildScript, NodeData, TreeData } from "vscode-behavior3/build";',
        "",
        "@behavior3.build",
        `export class ${className} implements BuildScript {`,
        "    constructor(private readonly env: BuildEnv) {}",
        "",
        "    onProcessTree(tree: TreeData, _path: string, _errors: string[]) {",
        "        return tree;",
        "    }",
        "",
        "    onProcessNode(node: NodeData, _errors: string[]) {",
        "        return node;",
        "    }",
        "",
        '    onComplete(status: "success" | "failure") {',
        "        this.env.logger.info(`build ${status}`);",
        "    }",
        "}",
        "",
    ].join("\n");
}

function createBatchScriptContent(baseName: string): string {
    const className = ensureSuffix(toPascalIdentifier(baseName), "Script");
    return [
        'import type { BatchScript, BuildEnv, NodeData, TreeData } from "vscode-behavior3/build";',
        "",
        "@behavior3.batch",
        `export class ${className} implements BatchScript {`,
        "    constructor(private readonly env: BuildEnv) {}",
        "",
        "    shouldUpgradeTree(_path: string, _tree: TreeData) {",
        "        return false;",
        "    }",
        "",
        "    onProcessTree(tree: TreeData, _path: string, _errors: string[]) {",
        "        return tree;",
        "    }",
        "",
        "    onProcessNode(node: NodeData, _errors: string[]) {",
        "        return node;",
        "    }",
        "",
        '    onComplete(status: "success" | "failure") {',
        "        this.env.logger.info(`batch ${status}`);",
        "    }",
        "}",
        "",
    ].join("\n");
}

function createCheckerScriptContent(baseName: string): string {
    const className = ensureSuffix(toPascalIdentifier(baseName), "Checker");
    const checkerName = toCheckerRegistrationName(baseName);
    return [
        'import type { NodeFieldCheckContext } from "vscode-behavior3/build";',
        "",
        `@behavior3.check("${checkerName}")`,
        `export class ${className} {`,
        "    validate(value: unknown, ctx: NodeFieldCheckContext) {",
        '        if (value === undefined || value === null || value === "") {',
        "            return;",
        "        }",
        '        if (typeof value !== "number") {',
        "            return `${ctx.fieldName} must be a number`;",
        "        }",
        "        if (value <= 0) {",
        "            return `${ctx.fieldName} must be greater than 0`;",
        "        }",
        "    }",
        "}",
        "",
    ].join("\n");
}

function toPascalIdentifier(value: string): string {
    const source = normalizeScriptScaffoldBaseName(value).replace(SCRIPT_FILE_EXTENSION_RE, "");
    const tokens = source.match(/[A-Za-z0-9]+/g) ?? [];
    const joined = tokens.map((token) => token.charAt(0).toUpperCase() + token.slice(1)).join("");
    if (!joined) {
        return "Generated";
    }
    if (/^[A-Za-z_$]/.test(joined)) {
        return joined;
    }
    return `Generated${joined}`;
}

function ensureSuffix(value: string, suffix: string): string {
    return value.toLowerCase().endsWith(suffix.toLowerCase()) ? value : `${value}${suffix}`;
}

function toCheckerRegistrationName(value: string): string {
    const normalized = normalizeScriptScaffoldBaseName(value)
        .replace(SCRIPT_FILE_EXTENSION_RE, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return normalized || "checker";
}
