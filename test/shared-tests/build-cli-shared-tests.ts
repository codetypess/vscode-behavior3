import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    batchProcessBehaviorProject,
    buildBehaviorProject,
    resolveBehaviorBuildPaths,
} from "../../src/build/build-cli";
import b3path from "../../webview/shared/b3path";
import {
    collectNodeFieldCheckDiagnostics,
    createBuildScriptRuntimeWithCheckModules,
    createNodeFieldVisibleRuntimeWithCheckModules,
    loadRuntimeModule,
    resolveNodeFieldVisibility,
    resolveCheckScriptPaths,
} from "../../webview/shared/b3build";
import { createTestTree } from "../shared-test-fixtures";
import { defineSharedTests } from "../shared-test-types";

const canonicalPath = (filePath: string) => fs.realpathSync.native(filePath);

export const buildCliSharedTests = defineSharedTests([
    {
        name: "resolves project files and builds from the CLI API",
        async run() {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-cli-"));
            const workspaceFile = path.join(root, "workspace.b3-workspace");
            const settingFile = path.join(root, "node-config.b3-setting");
            const treeFile = path.join(root, "main.json");
            const outputDir = path.join(root, "dist");

            try {
                fs.writeFileSync(
                    workspaceFile,
                    JSON.stringify({
                        settings: {
                            checkExpr: true,
                        },
                    }),
                    "utf-8"
                );
                fs.writeFileSync(
                    settingFile,
                    JSON.stringify([
                        {
                            name: "Sequence",
                            type: "Composite",
                            desc: "",
                            children: -1,
                            status: ["|success"],
                        },
                        {
                            name: "Log",
                            type: "Action",
                            desc: "",
                        },
                    ]),
                    "utf-8"
                );
                fs.writeFileSync(
                    treeFile,
                    JSON.stringify({
                        version: "2.0.0",
                        name: "main",
                        prefix: "",
                        group: [],
                        variables: {
                            imports: [],
                            locals: [],
                        },
                        custom: {},
                        overrides: {},
                        root: {
                            uuid: "root",
                            id: "1",
                            name: "Sequence",
                            children: [
                                {
                                    uuid: "leaf",
                                    id: "2",
                                    name: "Log",
                                },
                            ],
                        },
                    }),
                    "utf-8"
                );

                const resolved = resolveBehaviorBuildPaths({
                    projectPath: treeFile,
                    outputDir,
                });

                assert.equal(resolved.workspaceFile, canonicalPath(workspaceFile));
                assert.equal(resolved.settingFile, canonicalPath(settingFile));
                assert.equal(resolved.workdir, canonicalPath(root));
                assert.equal(resolved.outputDir, outputDir);

                const result = await buildBehaviorProject({
                    projectPath: treeFile,
                    outputDir,
                });

                assert.equal(result.hasError, false);
                assert.equal(fs.existsSync(path.join(outputDir, "main.json")), true);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
    },
    {
        name: "loads decorated TypeScript build scripts with local TypeScript imports",
        async run() {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-build-ts-import-"));
            const scriptsDir = path.join(root, "scripts");
            const workspaceFile = path.join(root, "workspace.b3-workspace");
            const settingFile = path.join(root, "node-config.b3-setting");
            const treeFile = path.join(root, "main.json");
            const buildScriptFile = path.join(scriptsDir, "build.ts");
            const helperFile = path.join(scriptsDir, "helper.ts");
            const constantsFile = path.join(scriptsDir, "constants.ts");
            const outputDir = path.join(root, "dist");

            try {
                fs.mkdirSync(scriptsDir, { recursive: true });
                fs.writeFileSync(
                    workspaceFile,
                    JSON.stringify({
                        settings: {
                            buildScript: "scripts/build.ts",
                        },
                    })
                );
                fs.writeFileSync(
                    settingFile,
                    JSON.stringify([
                        {
                            name: "Root",
                            type: "Composite",
                            desc: "",
                            children: -1,
                        },
                    ])
                );
                fs.writeFileSync(
                    treeFile,
                    JSON.stringify({
                        version: "2.0.0",
                        name: "main",
                        prefix: "",
                        group: [],
                        variables: {
                            imports: [],
                            locals: [],
                        },
                        custom: {},
                        overrides: {},
                        root: {
                            uuid: "root",
                            id: "1",
                            name: "Root",
                            children: [],
                        },
                    })
                );
                fs.writeFileSync(
                    constantsFile,
                    [
                        'export const helperValue = "imported-helper";',
                        "export type HelperTree = { custom?: Record<string, unknown> };",
                        "",
                    ].join("\n")
                );
                fs.writeFileSync(
                    helperFile,
                    [
                        'import { helperValue, type HelperTree } from "./constants.ts";',
                        "",
                        "export function markTree(tree: HelperTree) {",
                        "  tree.custom = { ...(tree.custom ?? {}), helperValue };",
                        "}",
                        "",
                    ].join("\n")
                );
                fs.writeFileSync(
                    buildScriptFile,
                    [
                        'import { markTree } from "./helper.ts";',
                        "",
                        "@behavior3.build",
                        "export class CustomBuildScript {",
                        "  onProcessTree(tree) {",
                        "    markTree(tree);",
                        "    return tree;",
                        "  }",
                        "}",
                        "",
                    ].join("\n")
                );
                fs.writeFileSync(path.join(scriptsDir, "build.runtime.stale.0.mjs"), "");
                fs.writeFileSync(path.join(scriptsDir, "helper.runtime.stale.1.mjs"), "");

                const result = await buildBehaviorProject({
                    projectPath: treeFile,
                    outputDir,
                });
                const outputTree = JSON.parse(
                    fs.readFileSync(path.join(outputDir, "main.json"), "utf-8")
                );
                const runtimeFiles = fs
                    .readdirSync(scriptsDir)
                    .filter((file) => file.includes(".runtime.") && file.endsWith(".mjs"));

                assert.equal(result.hasError, false);
                assert.equal(outputTree.custom.helperValue, "imported-helper");
                assert.deepEqual(runtimeFiles, []);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
    },
    {
        name: "runs build scripts with process cwd set to the resolved project directory",
        async run() {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-build-cwd-"));
            const scriptsDir = path.join(root, "scripts");
            const workspaceFile = path.join(root, "workspace.b3-workspace");
            const settingFile = path.join(root, "node-config.b3-setting");
            const treeFile = path.join(root, "main.json");
            const buildScriptFile = path.join(scriptsDir, "build.ts");
            const outputDir = path.join(root, "dist");
            const previousCwd = process.cwd();

            try {
                fs.mkdirSync(scriptsDir, { recursive: true });
                fs.writeFileSync(
                    workspaceFile,
                    JSON.stringify({
                        settings: {
                            buildScript: "scripts/build.ts",
                        },
                    })
                );
                fs.writeFileSync(
                    settingFile,
                    JSON.stringify([
                        {
                            name: "Root",
                            type: "Composite",
                            desc: "",
                            children: -1,
                        },
                    ])
                );
                fs.writeFileSync(
                    treeFile,
                    JSON.stringify({
                        version: "2.0.0",
                        name: "main",
                        prefix: "",
                        group: [],
                        variables: {
                            imports: [],
                            locals: [],
                        },
                        custom: {},
                        overrides: {},
                        root: {
                            uuid: "root",
                            id: "1",
                            name: "Root",
                            children: [],
                        },
                    })
                );
                fs.writeFileSync(
                    buildScriptFile,
                    [
                        'import fs from "node:fs";',
                        'import path from "node:path";',
                        "",
                        "@behavior3.build",
                        "export class CwdBuildScript {",
                        "  onProcessTree(tree) {",
                        '    tree.custom = { cwd: process.cwd(), hasWorkspace: fs.existsSync(path.join(process.cwd(), "workspace.b3-workspace")) };',
                        "    return tree;",
                        "  }",
                        "}",
                        "",
                    ].join("\n")
                );

                const result = await buildBehaviorProject({
                    projectPath: treeFile,
                    outputDir,
                });
                const outputTree = JSON.parse(
                    fs.readFileSync(path.join(outputDir, "main.json"), "utf-8")
                );

                assert.equal(result.hasError, false);
                assert.equal(outputTree.custom.cwd, canonicalPath(root));
                assert.equal(outputTree.custom.hasWorkspace, true);
                assert.equal(process.cwd(), previousCwd);
            } finally {
                process.chdir(previousCwd);
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
    },
    {
        name: "does not treat batch-decorated scripts as build hooks in the build pipeline",
        async run() {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-build-batch-decorator-"));
            const scriptsDir = path.join(root, "scripts");
            const workspaceFile = path.join(root, "workspace.b3-workspace");
            const settingFile = path.join(root, "node-config.b3-setting");
            const treeFile = path.join(root, "main.json");
            const buildScriptFile = path.join(scriptsDir, "build.ts");
            const outputDir = path.join(root, "dist");

            try {
                fs.mkdirSync(scriptsDir, { recursive: true });
                fs.writeFileSync(
                    workspaceFile,
                    JSON.stringify({
                        settings: {
                            buildScript: "scripts/build.ts",
                        },
                    })
                );
                fs.writeFileSync(
                    settingFile,
                    JSON.stringify([
                        {
                            name: "Root",
                            type: "Composite",
                            desc: "",
                            children: -1,
                        },
                    ])
                );
                fs.writeFileSync(
                    treeFile,
                    JSON.stringify({
                        version: "2.0.0",
                        name: "main",
                        prefix: "",
                        group: [],
                        variables: {
                            imports: [],
                            locals: [],
                        },
                        custom: {},
                        overrides: {},
                        root: {
                            uuid: "root",
                            id: "1",
                            name: "Root",
                            children: [],
                        },
                    })
                );
                fs.writeFileSync(
                    buildScriptFile,
                    [
                        "@behavior3.batch",
                        "export class BatchOnlyScript {",
                        "  onProcessTree(tree) {",
                        "    tree.custom = { ...(tree.custom ?? {}), touchedByBatch: true };",
                        "    return tree;",
                        "  }",
                        "}",
                        "",
                    ].join("\n")
                );

                const result = await buildBehaviorProject({
                    projectPath: treeFile,
                    outputDir,
                });
                const outputTree = JSON.parse(
                    fs.readFileSync(path.join(outputDir, "main.json"), "utf-8")
                );

                assert.equal(result.hasError, true);
                assert.equal(outputTree.custom?.touchedByBatch, undefined);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
    },
    {
        name: "batch processes source trees with TypeScript imports and rewrites files in place",
        async run() {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-batch-ts-import-"));
            const scriptsDir = path.join(root, "scripts");
            const workspaceFile = path.join(root, "workspace.b3-workspace");
            const settingFile = path.join(root, "node-config.b3-setting");
            const mainTreeFile = path.join(root, "main.json");
            const nestedTreeFile = path.join(root, "trees", "secondary.json");
            const buildScriptFile = path.join(scriptsDir, "batch.ts");
            const helperFile = path.join(scriptsDir, "helper.ts");
            const constantsFile = path.join(scriptsDir, "constants.ts");

            try {
                fs.mkdirSync(path.dirname(nestedTreeFile), { recursive: true });
                fs.mkdirSync(scriptsDir, { recursive: true });
                fs.writeFileSync(workspaceFile, JSON.stringify({ settings: {} }));
                fs.writeFileSync(
                    settingFile,
                    JSON.stringify([
                        {
                            name: "Sequence",
                            type: "Composite",
                            desc: "",
                            children: -1,
                        },
                    ])
                );

                const mainTree = createTestTree();
                mainTree.name = "main";
                const nestedTree = createTestTree();
                nestedTree.name = "secondary";
                fs.writeFileSync(mainTreeFile, JSON.stringify(mainTree));
                fs.writeFileSync(nestedTreeFile, JSON.stringify(nestedTree));

                fs.writeFileSync(
                    constantsFile,
                    ['export const migratedBy = "batch-import";', ""].join("\n")
                );
                fs.writeFileSync(
                    helperFile,
                    [
                        'import { migratedBy } from "./constants.ts";',
                        "",
                        "export function markTree(tree, treePath) {",
                        "  tree.custom = { ...(tree.custom ?? {}), migratedBy, treePath };",
                        "}",
                        "",
                    ].join("\n")
                );
                fs.writeFileSync(
                    buildScriptFile,
                    [
                        'import { markTree } from "./helper.ts";',
                        "",
                        "@behavior3.batch",
                        "export class BatchProcessScript {",
                        "  onProcessTree(tree, treePath) {",
                        "    markTree(tree, treePath);",
                        "    return tree;",
                        "  }",
                        "}",
                        "",
                    ].join("\n")
                );

                const result = await batchProcessBehaviorProject({
                    workspaceFile,
                    settingFile,
                    scriptFile: buildScriptFile,
                });
                const mainTreeOutput = JSON.parse(fs.readFileSync(mainTreeFile, "utf-8"));
                const nestedTreeOutput = JSON.parse(fs.readFileSync(nestedTreeFile, "utf-8"));
                const runtimeFiles = fs
                    .readdirSync(scriptsDir)
                    .filter((file) => file.includes(".runtime.") && file.endsWith(".mjs"));

                assert.equal(result.hasError, false);
                assert.equal(result.summary.totalFiles, 2);
                assert.equal(result.summary.writtenFiles, 2);
                assert.equal(result.summary.stagedWriteFiles, 2);
                assert.equal(result.summary.unchangedFiles, 0);
                assert.equal(result.summary.skippedFiles, 0);
                assert.equal(result.summary.failedFiles, 0);
                assert.equal(mainTreeOutput.custom.migratedBy, "batch-import");
                assert.equal(nestedTreeOutput.custom.migratedBy, "batch-import");
                assert.equal(Array.isArray(runtimeFiles), true);
                assert.deepEqual(runtimeFiles, []);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
    },
    {
        name: "keeps legacy build-decorated batch scripts working as a compatibility fallback",
        async run() {
            const root = fs.mkdtempSync(
                path.join(os.tmpdir(), "behavior3-batch-legacy-decorator-")
            );
            const workspaceFile = path.join(root, "workspace.b3-workspace");
            const settingFile = path.join(root, "node-config.b3-setting");
            const treeFile = path.join(root, "main.json");
            const buildScriptFile = path.join(root, "batch.ts");

            try {
                fs.writeFileSync(workspaceFile, JSON.stringify({ settings: {} }));
                fs.writeFileSync(
                    settingFile,
                    JSON.stringify([
                        {
                            name: "Sequence",
                            type: "Composite",
                            desc: "",
                            children: -1,
                        },
                    ])
                );

                const tree = createTestTree();
                tree.name = "main";
                fs.writeFileSync(treeFile, JSON.stringify(tree));
                fs.writeFileSync(
                    buildScriptFile,
                    [
                        "@behavior3.build",
                        "export class LegacyBatchScript {",
                        "  onProcessTree(tree) {",
                        "    tree.custom = { ...(tree.custom ?? {}), legacyDecorator: true };",
                        "    return tree;",
                        "  }",
                        "}",
                        "",
                    ].join("\n")
                );

                const result = await batchProcessBehaviorProject({
                    workspaceFile,
                    settingFile,
                    scriptFile: buildScriptFile,
                });
                const parsedTree = JSON.parse(fs.readFileSync(treeFile, "utf-8"));

                assert.equal(result.hasError, false);
                assert.equal(result.summary.writtenFiles, 1);
                assert.equal(parsedTree.custom.legacyDecorator, true);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
    },
    {
        name: "keeps legacy batch input tree unchanged by default when script is no-op",
        async run() {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-batch-legacy-default-"));
            const workspaceFile = path.join(root, "workspace.b3-workspace");
            const settingFile = path.join(root, "node-config.b3-setting");
            const treeFile = path.join(root, "main.json");
            const buildScriptFile = path.join(root, "batch.ts");

            try {
                fs.writeFileSync(workspaceFile, JSON.stringify({ settings: {} }));
                fs.writeFileSync(
                    settingFile,
                    JSON.stringify([
                        {
                            name: "Sequence",
                            type: "Composite",
                            desc: "",
                            children: -1,
                        },
                    ])
                );

                const legacyContent = JSON.stringify({
                    version: "2.0.0",
                    name: "main",
                    prefix: "",
                    group: [],
                    import: ["vars/legacy.json"],
                    vars: [{ name: "legacyVar", desc: "legacy variable" }],
                    custom: {},
                    $override: {
                        "legacy-leaf": {
                            desc: "from-legacy",
                        },
                    },
                    root: {
                        $id: "legacy-root",
                        id: "1",
                        name: "Sequence",
                        children: [
                            {
                                $id: "legacy-leaf",
                                id: "2",
                                name: "Sequence",
                            },
                        ],
                    },
                });
                fs.writeFileSync(treeFile, legacyContent);
                fs.writeFileSync(
                    buildScriptFile,
                    [
                        "@behavior3.batch",
                        "export class NoopBatchScript {",
                        "  onProcessTree(tree) {",
                        "    return tree;",
                        "  }",
                        "}",
                        "",
                    ].join("\n")
                );

                const result = await batchProcessBehaviorProject({
                    workspaceFile,
                    settingFile,
                    scriptFile: buildScriptFile,
                });

                assert.equal(result.hasError, false);
                assert.equal(result.summary.totalFiles, 1);
                assert.equal(result.summary.stagedWriteFiles, 0);
                assert.equal(result.summary.writtenFiles, 0);
                assert.equal(result.summary.unchangedFiles, 1);
                assert.equal(fs.readFileSync(treeFile, "utf-8"), legacyContent);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
    },
    {
        name: "upgrades legacy batch input tree when batch script requests it",
        async run() {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-batch-legacy-upgrade-"));
            const workspaceFile = path.join(root, "workspace.b3-workspace");
            const settingFile = path.join(root, "node-config.b3-setting");
            const treeFile = path.join(root, "main.json");
            const buildScriptFile = path.join(root, "batch.ts");
            const writeMarkerFile = `${treeFile}.marker`;

            try {
                fs.writeFileSync(workspaceFile, JSON.stringify({ settings: {} }));
                fs.writeFileSync(
                    settingFile,
                    JSON.stringify([
                        {
                            name: "Sequence",
                            type: "Composite",
                            desc: "",
                            children: -1,
                        },
                    ])
                );

                fs.writeFileSync(
                    treeFile,
                    JSON.stringify({
                        version: "2.0.0",
                        name: "main",
                        prefix: "",
                        group: [],
                        import: ["vars/legacy.json"],
                        vars: [{ name: "legacyVar", desc: "legacy variable" }],
                        custom: {},
                        $override: {
                            "legacy-leaf": {
                                desc: "from-legacy",
                            },
                        },
                        root: {
                            $id: "legacy-root",
                            id: "1",
                            name: "Sequence",
                            children: [
                                {
                                    $id: "legacy-leaf",
                                    id: "2",
                                    name: "Sequence",
                                },
                            ],
                        },
                    })
                );
                fs.writeFileSync(
                    buildScriptFile,
                    [
                        "@behavior3.batch",
                        "export class NoopBatchScript {",
                        "  constructor(env) {",
                        "    this.env = env;",
                        "  }",
                        "  shouldUpgradeTree() {",
                        "    return true;",
                        "  }",
                        "  onProcessTree(tree) {",
                        "    return tree;",
                        "  }",
                        "  onWriteFile(path) {",
                        '    this.env.fs.writeFileSync(path + ".marker", "written");',
                        "  }",
                        "}",
                        "",
                    ].join("\n")
                );

                const result = await batchProcessBehaviorProject({
                    workspaceFile,
                    settingFile,
                    scriptFile: buildScriptFile,
                });
                const upgradedTree = JSON.parse(fs.readFileSync(treeFile, "utf-8"));

                assert.equal(result.hasError, false);
                assert.equal(result.summary.totalFiles, 1);
                assert.equal(result.summary.stagedWriteFiles, 1);
                assert.equal(result.summary.writtenFiles, 1);
                assert.equal(result.summary.unchangedFiles, 0);
                assert.equal(fs.readFileSync(writeMarkerFile, "utf-8"), "written");
                assert.equal(upgradedTree.root.uuid, "legacy-root");
                assert.equal(upgradedTree.root.$id, undefined);
                assert.equal(upgradedTree.root.children[0].uuid, "legacy-leaf");
                assert.deepEqual(upgradedTree.overrides, {
                    "legacy-leaf": { desc: "from-legacy" },
                });
                assert.deepEqual(upgradedTree.variables, {
                    imports: ["vars/legacy.json"],
                    locals: [{ name: "legacyVar", desc: "legacy variable" }],
                });
                assert.equal(upgradedTree.$override, undefined);
                assert.equal(upgradedTree.import, undefined);
                assert.equal(upgradedTree.vars, undefined);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
    },
    {
        name: "aborts batch input tree upgrades when batch script reports errors",
        async run() {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-batch-legacy-error-"));
            const workspaceFile = path.join(root, "workspace.b3-workspace");
            const settingFile = path.join(root, "node-config.b3-setting");
            const goodTreeFile = path.join(root, "good.json");
            const badTreeFile = path.join(root, "bad.json");
            const buildScriptFile = path.join(root, "batch.ts");

            try {
                fs.writeFileSync(workspaceFile, JSON.stringify({ settings: {} }));
                fs.writeFileSync(
                    settingFile,
                    JSON.stringify([
                        {
                            name: "Sequence",
                            type: "Composite",
                            desc: "",
                            children: -1,
                        },
                    ])
                );

                const createLegacyContent = (name: string) =>
                    JSON.stringify({
                        version: "2.0.0",
                        name,
                        prefix: "",
                        group: [],
                        import: ["vars/legacy.json"],
                        vars: [{ name: "legacyVar", desc: "legacy variable" }],
                        custom: {},
                        $override: {},
                        root: {
                            $id: `${name}-root`,
                            id: "1",
                            name: "Sequence",
                        },
                    });
                const goodBefore = createLegacyContent("good");
                const badBefore = createLegacyContent("bad");
                fs.writeFileSync(goodTreeFile, goodBefore);
                fs.writeFileSync(badTreeFile, badBefore);
                fs.writeFileSync(
                    buildScriptFile,
                    [
                        "@behavior3.batch",
                        "export class ErrorBatchScript {",
                        "  shouldUpgradeTree() {",
                        "    return true;",
                        "  }",
                        "  onProcessTree(tree, treePath, errors) {",
                        "    if (treePath.endsWith('/bad.json') || treePath.endsWith('\\\\bad.json')) {",
                        '      errors.push("script rejected this tree");',
                        "    }",
                        "    return tree;",
                        "  }",
                        "}",
                        "",
                    ].join("\n")
                );

                const result = await batchProcessBehaviorProject({
                    workspaceFile,
                    settingFile,
                    scriptFile: buildScriptFile,
                });

                assert.equal(result.hasError, true);
                assert.equal(result.summary.totalFiles, 2);
                assert.equal(result.summary.writtenFiles, 0);
                assert.equal(result.summary.failedFiles, 1);
                assert.equal(fs.readFileSync(goodTreeFile, "utf-8"), goodBefore);
                assert.equal(fs.readFileSync(badTreeFile, "utf-8"), badBefore);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
    },
    {
        name: "writes batch source rewrites without node legality validation",
        async run() {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-batch-no-validate-"));
            const workspaceFile = path.join(root, "workspace.b3-workspace");
            const settingFile = path.join(root, "node-config.b3-setting");
            const goodTreeFile = path.join(root, "good.json");
            const badTreeFile = path.join(root, "bad.json");
            const buildScriptFile = path.join(root, "batch.ts");

            try {
                fs.writeFileSync(workspaceFile, JSON.stringify({ settings: {} }));
                fs.writeFileSync(
                    settingFile,
                    JSON.stringify([
                        {
                            name: "Sequence",
                            type: "Composite",
                            desc: "",
                            children: -1,
                        },
                    ])
                );

                const goodTree = createTestTree();
                goodTree.name = "good";
                const badTree = createTestTree();
                badTree.name = "bad";
                fs.writeFileSync(goodTreeFile, JSON.stringify(goodTree));
                fs.writeFileSync(badTreeFile, JSON.stringify(badTree));

                fs.writeFileSync(
                    buildScriptFile,
                    [
                        "@behavior3.batch",
                        "export class InvalidBatchScript {",
                        "  onProcessTree(tree, treePath) {",
                        "    tree.custom = { ...(tree.custom ?? {}), touched: true };",
                        "    if (treePath.endsWith('/bad.json') || treePath.endsWith('\\\\bad.json')) {",
                        '      tree.root.name = "MissingNode";',
                        "    }",
                        "    return tree;",
                        "  }",
                        "}",
                        "",
                    ].join("\n")
                );

                const result = await batchProcessBehaviorProject({
                    workspaceFile,
                    settingFile,
                    scriptFile: buildScriptFile,
                });
                const parsedGood = JSON.parse(fs.readFileSync(goodTreeFile, "utf-8"));
                const parsedBad = JSON.parse(fs.readFileSync(badTreeFile, "utf-8"));

                assert.equal(result.hasError, false);
                assert.equal(result.summary.totalFiles, 2);
                assert.equal(result.summary.writtenFiles, 2);
                assert.equal(result.summary.stagedWriteFiles, 2);
                assert.equal(result.summary.failedFiles, 0);
                assert.equal(parsedGood.custom.touched, true);
                assert.equal(parsedBad.custom.touched, true);
                assert.equal(parsedBad.root.name, "MissingNode");
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
    },
    {
        name: "aborts batch source rewrites when batch script reports errors",
        async run() {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-batch-script-error-"));
            const workspaceFile = path.join(root, "workspace.b3-workspace");
            const settingFile = path.join(root, "node-config.b3-setting");
            const goodTreeFile = path.join(root, "good.json");
            const badTreeFile = path.join(root, "bad.json");
            const buildScriptFile = path.join(root, "batch.ts");

            try {
                fs.writeFileSync(workspaceFile, JSON.stringify({ settings: {} }));
                fs.writeFileSync(
                    settingFile,
                    JSON.stringify([
                        {
                            name: "Sequence",
                            type: "Composite",
                            desc: "",
                            children: -1,
                        },
                    ])
                );

                const goodTree = createTestTree();
                goodTree.name = "good";
                const badTree = createTestTree();
                badTree.name = "bad";
                fs.writeFileSync(goodTreeFile, JSON.stringify(goodTree));
                fs.writeFileSync(badTreeFile, JSON.stringify(badTree));

                const goodBefore = fs.readFileSync(goodTreeFile, "utf-8");
                const badBefore = fs.readFileSync(badTreeFile, "utf-8");
                fs.writeFileSync(
                    buildScriptFile,
                    [
                        "@behavior3.batch",
                        "export class ErrorBatchScript {",
                        "  onProcessTree(tree, treePath, errors) {",
                        "    tree.custom = { ...(tree.custom ?? {}), touched: true };",
                        "    if (treePath.endsWith('/bad.json') || treePath.endsWith('\\\\bad.json')) {",
                        '      errors.push("script rejected this tree");',
                        "    }",
                        "    return tree;",
                        "  }",
                        "}",
                        "",
                    ].join("\n")
                );

                const result = await batchProcessBehaviorProject({
                    workspaceFile,
                    settingFile,
                    scriptFile: buildScriptFile,
                });

                assert.equal(result.hasError, true);
                assert.equal(result.summary.totalFiles, 2);
                assert.equal(result.summary.writtenFiles, 0);
                assert.equal(result.summary.failedFiles, 1);
                assert.equal(fs.readFileSync(goodTreeFile, "utf-8"), goodBefore);
                assert.equal(fs.readFileSync(badTreeFile, "utf-8"), badBefore);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
    },
    {
        name: "ignores workspace checkScripts during batch processing",
        async run() {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-batch-ignore-checks-"));
            const workspaceFile = path.join(root, "workspace.b3-workspace");
            const settingFile = path.join(root, "node-config.b3-setting");
            const treeFile = path.join(root, "main.json");
            const buildScriptFile = path.join(root, "batch.ts");

            try {
                fs.writeFileSync(
                    workspaceFile,
                    JSON.stringify({ settings: { checkScripts: ["missing-checks/**/*.ts"] } })
                );
                fs.writeFileSync(
                    settingFile,
                    JSON.stringify([
                        {
                            name: "Sequence",
                            type: "Composite",
                            desc: "",
                            children: -1,
                        },
                    ])
                );

                const tree = createTestTree();
                tree.name = "main";
                fs.writeFileSync(treeFile, JSON.stringify(tree));
                fs.writeFileSync(
                    buildScriptFile,
                    [
                        "@behavior3.batch",
                        "export class BatchScript {",
                        "  onProcessTree(tree) {",
                        "    tree.custom = { ...(tree.custom ?? {}), touched: true };",
                        "    return tree;",
                        "  }",
                        "}",
                        "",
                    ].join("\n")
                );

                const result = await batchProcessBehaviorProject({
                    workspaceFile,
                    settingFile,
                    scriptFile: buildScriptFile,
                });
                const parsedTree = JSON.parse(fs.readFileSync(treeFile, "utf-8"));

                assert.equal(result.hasError, false);
                assert.equal(result.summary.totalFiles, 1);
                assert.equal(result.summary.writtenFiles, 1);
                assert.equal(result.summary.failedFiles, 0);
                assert.equal(parsedTree.custom.touched, true);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
    },
    {
        name: "loads TypeScript build scripts concurrently without deleting active runtime modules",
        async run() {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-build-concurrent-"));
            const scriptsDir = path.join(root, "scripts");
            const buildScriptFile = path.join(scriptsDir, "build.ts");
            const helperFile = path.join(scriptsDir, "helper.ts");
            const constantsFile = path.join(scriptsDir, "constants.ts");

            try {
                fs.mkdirSync(scriptsDir, { recursive: true });
                fs.writeFileSync(
                    constantsFile,
                    ['export const helperValue = "concurrent-helper";', ""].join("\n")
                );
                fs.writeFileSync(
                    helperFile,
                    [
                        'import { helperValue } from "./constants.ts";',
                        "",
                        "export const value = helperValue;",
                        "",
                    ].join("\n")
                );
                fs.writeFileSync(
                    buildScriptFile,
                    [
                        'import { value } from "./helper.ts";',
                        "",
                        "@behavior3.build",
                        "export class ConcurrentBuildScript {",
                        "  static helperValue = value;",
                        "}",
                        "",
                    ].join("\n")
                );

                for (let round = 0; round < 5; round += 1) {
                    const modules = await Promise.all(
                        Array.from({ length: 8 }, () =>
                            loadRuntimeModule(buildScriptFile, { debug: false })
                        )
                    );

                    assert.equal(modules.every(Boolean), true);
                    for (const moduleExports of modules) {
                        const buildModule = moduleExports as {
                            ConcurrentBuildScript?: { helperValue?: string };
                        } | null;
                        assert.equal(
                            buildModule?.ConcurrentBuildScript?.helperValue,
                            "concurrent-helper"
                        );
                    }
                }

                const runtimeFiles = fs
                    .readdirSync(scriptsDir)
                    .filter((file) => file.includes(".runtime.") && file.endsWith(".mjs"));

                assert.deepEqual(runtimeFiles, []);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
    },
    {
        name: "keeps behavior3 decorator global alive across overlapping runtime imports",
        async run() {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-decorator-global-"));
            const scriptsDir = path.join(root, "scripts");
            const fastScriptFile = path.join(scriptsDir, "fast.ts");
            const slowScriptFile = path.join(scriptsDir, "slow.ts");

            try {
                fs.mkdirSync(scriptsDir, { recursive: true });
                fs.writeFileSync(
                    fastScriptFile,
                    [
                        '@behavior3.check("fast")',
                        "export class FastChecker {",
                        "  validate() {}",
                        "}",
                        "",
                    ].join("\n")
                );
                fs.writeFileSync(
                    slowScriptFile,
                    [
                        "await new Promise((resolve) => setTimeout(resolve, 25));",
                        "",
                        '@behavior3.check("slow")',
                        "export class SlowChecker {",
                        "  validate() {}",
                        "}",
                        "",
                    ].join("\n")
                );

                const [fastModule, slowModule] = await Promise.all([
                    loadRuntimeModule(fastScriptFile, { debug: false }),
                    loadRuntimeModule(slowScriptFile, { debug: false }),
                ]);

                assert.equal(Boolean(fastModule), true);
                assert.equal(Boolean(slowModule), true);
                assert.equal(
                    typeof (fastModule as { FastChecker?: unknown } | null)?.FastChecker,
                    "function"
                );
                assert.equal(
                    typeof (slowModule as { SlowChecker?: unknown } | null)?.SlowChecker,
                    "function"
                );
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
    },
    {
        name: "runs decorated node arg checkers during build",
        async run() {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-build-checker-"));
            const scriptsDir = path.join(root, "scripts");
            const workspaceFile = path.join(root, "workspace.b3-workspace");
            const settingFile = path.join(root, "node-config.b3-setting");
            const treeFile = path.join(root, "main.json");
            const buildScriptFile = path.join(scriptsDir, "build.ts");
            const outputDir = path.join(root, "dist");

            try {
                fs.mkdirSync(scriptsDir, { recursive: true });
                fs.writeFileSync(
                    workspaceFile,
                    JSON.stringify({
                        settings: {
                            buildScript: "scripts/build.ts",
                        },
                    })
                );
                fs.writeFileSync(
                    settingFile,
                    JSON.stringify([
                        {
                            name: "Wait",
                            type: "Action",
                            desc: "",
                            args: [
                                {
                                    name: "time",
                                    type: "float",
                                    desc: "",
                                    checker: "positive",
                                },
                            ],
                        },
                    ])
                );
                fs.writeFileSync(
                    treeFile,
                    JSON.stringify({
                        version: "2.0.0",
                        name: "main",
                        prefix: "",
                        group: [],
                        variables: {
                            imports: [],
                            locals: [],
                        },
                        custom: {},
                        overrides: {},
                        root: {
                            uuid: "root",
                            id: "1",
                            name: "Wait",
                            args: {
                                time: 0,
                            },
                        },
                    })
                );
                fs.writeFileSync(
                    buildScriptFile,
                    [
                        '@behavior3.check("positive")',
                        "export class PositiveChecker {",
                        "  validate(value) {",
                        "    if (typeof value !== 'number' || value <= 0) {",
                        "      return 'must be greater than 0';",
                        "    }",
                        "  }",
                        "}",
                        "",
                    ].join("\n")
                );

                const result = await buildBehaviorProject({
                    projectPath: treeFile,
                    outputDir,
                });

                assert.equal(result.hasError, true);
                assert.equal(fs.existsSync(path.join(outputDir, "main.json")), true);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
    },
    {
        name: "loads node arg checkers from workspace checkScripts",
        async run() {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-check-scripts-"));
            const checkersDir = path.join(root, "scripts", "checkers");
            const workspaceFile = path.join(root, "workspace.b3-workspace");
            const settingFile = path.join(root, "node-config.b3-setting");
            const treeFile = path.join(root, "main.json");
            const checkerFile = path.join(checkersDir, "positive.ts");
            const outputDir = path.join(root, "dist");

            try {
                fs.mkdirSync(checkersDir, { recursive: true });
                fs.writeFileSync(
                    workspaceFile,
                    JSON.stringify({
                        settings: {
                            checkScripts: ["scripts/checkers/**/*.ts"],
                        },
                    })
                );
                fs.writeFileSync(
                    settingFile,
                    JSON.stringify([
                        {
                            name: "Wait",
                            type: "Action",
                            desc: "",
                            args: [
                                {
                                    name: "time",
                                    type: "float",
                                    desc: "",
                                    checker: "positive",
                                },
                            ],
                        },
                    ])
                );
                fs.writeFileSync(
                    treeFile,
                    JSON.stringify({
                        version: "2.0.0",
                        name: "main",
                        prefix: "",
                        group: [],
                        variables: {
                            imports: [],
                            locals: [],
                        },
                        custom: {},
                        overrides: {},
                        root: {
                            uuid: "root",
                            id: "1",
                            name: "Wait",
                            args: {
                                time: 0,
                            },
                        },
                    })
                );
                fs.writeFileSync(
                    checkerFile,
                    [
                        '@behavior3.check("positive")',
                        "export class PositiveChecker {",
                        "  validate(value) {",
                        "    if (typeof value !== 'number' || value <= 0) {",
                        "      return 'must be greater than 0';",
                        "    }",
                        "  }",
                        "}",
                        "",
                    ].join("\n")
                );

                const result = await buildBehaviorProject({
                    projectPath: treeFile,
                    outputDir,
                });

                assert.equal(result.hasError, true);
                assert.equal(fs.existsSync(path.join(outputDir, "main.json")), true);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
    },
    {
        name: "registers node arg visible hooks without relaxing build runtime export checks",
        async run() {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-visible-hooks-"));
            const scriptsDir = path.join(root, "scripts");
            const visibleFile = path.join(scriptsDir, "show-time.ts");
            const workdir = root.replace(/\\/g, "/");
            const noop = () => {};

            try {
                fs.mkdirSync(scriptsDir, { recursive: true });
                fs.writeFileSync(
                    visibleFile,
                    [
                        '@behavior3.visible("show-time")',
                        "export class ShowTimeVisible {",
                        "  visible(_value, ctx) {",
                        "    return ctx.node.args?.mode === 'delay';",
                        "  }",
                        "}",
                        "",
                    ].join("\n")
                );

                const moduleExports = await loadRuntimeModule(visibleFile, { debug: false });
                assert.ok(moduleExports, `expected runtime module for ${visibleFile}`);

                const env = {
                    fs,
                    path: b3path,
                    workdir,
                    nodeDefs: new Map([
                        [
                            "Wait",
                            {
                                name: "Wait",
                                type: "Action",
                                desc: "",
                                args: [
                                    { name: "mode", type: "string", desc: "" },
                                    {
                                        name: "time",
                                        type: "float",
                                        desc: "",
                                        visible: "show-time",
                                    },
                                ],
                            },
                        ],
                    ]),
                    logger: {
                        log: noop,
                        debug: noop,
                        info: noop,
                        warn: noop,
                        error: noop,
                    },
                };

                const visibleRuntime = createNodeFieldVisibleRuntimeWithCheckModules(
                    moduleExports,
                    [],
                    env
                );
                assert.equal(visibleRuntime.nodeFieldVisibles.has("show-time"), true);

                const buildRuntime = createBuildScriptRuntimeWithCheckModules(
                    moduleExports,
                    [],
                    env
                );
                assert.equal(buildRuntime.hasEntries, false);
                assert.equal(buildRuntime.hasError, true);
                assert.equal(buildRuntime.nodeFieldCheckers.size, 0);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
    },
    {
        name: "warns when node arg visible hooks are not registered and falls back to visible",
        run() {
            const warnings: string[] = [];
            const workdir = "/work";
            const env = {
                fs,
                path: b3path,
                workdir,
                nodeDefs: new Map([
                    [
                        "Wait",
                        {
                            name: "Wait",
                            type: "Action",
                            desc: "",
                            args: [
                                {
                                    name: "time",
                                    type: "float",
                                    desc: "",
                                    visible: "show-time",
                                },
                            ],
                        },
                    ],
                ]),
                logger: {
                    log() {},
                    debug() {},
                    info() {},
                    warn: (...args: unknown[]) => warnings.push(args.map(String).join(" ")),
                    error() {},
                },
            };

            const visibility = resolveNodeFieldVisibility({
                tree: createTestTree({
                    root: {
                        uuid: "root",
                        id: "1",
                        name: "Wait",
                        args: {
                            time: 1,
                        },
                    },
                }),
                treePath: `${workdir}/main.json`,
                env,
                visibles: new Map(),
                target: {
                    uuid: "root",
                    id: "1",
                    name: "Wait",
                    args: {
                        time: 1,
                    },
                },
            });

            assert.deepEqual(visibility, { args: {}, input: {}, output: {} });
            assert.equal(warnings.length, 1);
            assert.match(warnings[0] ?? "", /visible 'show-time' is not registered/i);
        },
    },
    {
        name: "reports disabled visible expressions as field diagnostics and keeps fields visible",
        run() {
            const warnings: string[] = [];
            const workdir = "/work";
            const visibleExpression = 'args.type==4 || input[0] == "x"';
            const env = {
                fs,
                path: b3path,
                workdir,
                allowNewFunction: false,
                nodeDefs: new Map([
                    [
                        "Wait",
                        {
                            name: "Wait",
                            type: "Action",
                            desc: "",
                            input: ["condition"],
                            args: [
                                {
                                    name: "type",
                                    type: "int",
                                    desc: "",
                                },
                                {
                                    name: "time",
                                    type: "float",
                                    desc: "",
                                    visible: visibleExpression,
                                },
                            ],
                        },
                    ],
                ]),
                logger: {
                    log() {},
                    debug() {},
                    info() {},
                    warn: (...args: unknown[]) => warnings.push(args.map(String).join(" ")),
                    error() {},
                },
            };

            const tree = {
                ...createTestTree(),
                root: {
                    uuid: "root",
                    id: "1",
                    name: "Wait",
                    args: {
                        type: 4,
                        time: 1,
                    },
                    input: ["x"],
                },
            };

            const diagnostics = collectNodeFieldCheckDiagnostics({
                tree,
                treePath: `${workdir}/main.json`,
                env,
                checkers: new Map(),
                visibles: new Map(),
            });

            assert.equal(diagnostics.length, 1);
            assert.equal(diagnostics[0]?.fieldKind, "arg");
            assert.equal(diagnostics[0]?.fieldName, "time");
            assert.equal(diagnostics[0]?.checker, visibleExpression);
            assert.match(diagnostics[0]?.message ?? "", /allowNewFunction/);

            const visibility = resolveNodeFieldVisibility({
                tree,
                treePath: `${workdir}/main.json`,
                env,
                visibles: new Map(),
                target: {
                    uuid: "root",
                    id: "1",
                    name: "Wait",
                    args: {
                        type: 4,
                        time: 1,
                    },
                    input: ["x"],
                },
            });

            assert.deepEqual(visibility, { args: {}, input: {}, output: {} });
            assert.equal(warnings.length, 1);
            assert.match(warnings[0] ?? "", /allowNewFunction/);
        },
    },
    {
        name: "evaluates visible expressions when allowNewFunction is enabled",
        run() {
            const warnings: string[] = [];
            const workdir = "/work";
            const visibleExpression = 'args.type==4 || input[0] == "x"';
            const env = {
                fs,
                path: b3path,
                workdir,
                allowNewFunction: true,
                nodeDefs: new Map([
                    [
                        "Wait",
                        {
                            name: "Wait",
                            type: "Action",
                            desc: "",
                            input: ["condition"],
                            args: [
                                {
                                    name: "type",
                                    type: "int",
                                    desc: "",
                                },
                                {
                                    name: "time",
                                    type: "float",
                                    desc: "",
                                    visible: visibleExpression,
                                },
                            ],
                        },
                    ],
                ]),
                logger: {
                    log() {},
                    debug() {},
                    info() {},
                    warn: (...args: unknown[]) => warnings.push(args.map(String).join(" ")),
                    error() {},
                },
            };

            const hiddenTree = {
                ...createTestTree(),
                root: {
                    uuid: "root",
                    id: "1",
                    name: "Wait",
                    args: {
                        type: 3,
                        time: 1,
                    },
                    input: ["y"],
                },
            };
            const shownTree = {
                ...createTestTree(),
                root: {
                    uuid: "root",
                    id: "1",
                    name: "Wait",
                    args: {
                        type: 4,
                        time: 1,
                    },
                    input: ["y"],
                },
            };

            const hiddenDiagnostics = collectNodeFieldCheckDiagnostics({
                tree: hiddenTree,
                treePath: `${workdir}/main.json`,
                env,
                checkers: new Map(),
                visibles: new Map(),
            });
            assert.deepEqual(hiddenDiagnostics, []);

            const hiddenVisibility = resolveNodeFieldVisibility({
                tree: hiddenTree,
                treePath: `${workdir}/main.json`,
                env,
                visibles: new Map(),
                target: {
                    uuid: "root",
                    id: "1",
                    name: "Wait",
                    args: {
                        type: 3,
                        time: 1,
                    },
                    input: ["y"],
                },
            });
            assert.deepEqual(hiddenVisibility, { args: { time: false }, input: {}, output: {} });

            const shownDiagnostics = collectNodeFieldCheckDiagnostics({
                tree: shownTree,
                treePath: `${workdir}/main.json`,
                env,
                checkers: new Map(),
                visibles: new Map(),
            });
            assert.deepEqual(shownDiagnostics, []);

            const shownVisibility = resolveNodeFieldVisibility({
                tree: shownTree,
                treePath: `${workdir}/main.json`,
                env,
                visibles: new Map(),
                target: {
                    uuid: "root",
                    id: "1",
                    name: "Wait",
                    args: {
                        type: 4,
                        time: 1,
                    },
                    input: ["y"],
                },
            });
            assert.deepEqual(shownVisibility, { args: { time: true }, input: {}, output: {} });
            assert.deepEqual(warnings, []);
        },
    },
    {
        name: "reports visible expressions that reference undefined args as field diagnostics",
        run() {
            const warnings: string[] = [];
            const workdir = "/work";
            const visibleExpression = "args.typexxx == 4";
            const env = {
                fs,
                path: b3path,
                workdir,
                allowNewFunction: true,
                nodeDefs: new Map([
                    [
                        "Wait",
                        {
                            name: "Wait",
                            type: "Action",
                            desc: "",
                            args: [
                                {
                                    name: "type",
                                    type: "int",
                                    desc: "",
                                },
                                {
                                    name: "time",
                                    type: "float",
                                    desc: "",
                                    visible: visibleExpression,
                                },
                            ],
                        },
                    ],
                ]),
                logger: {
                    log() {},
                    debug() {},
                    info() {},
                    warn: (...args: unknown[]) => warnings.push(args.map(String).join(" ")),
                    error() {},
                },
            };

            const tree = {
                ...createTestTree(),
                root: {
                    uuid: "root",
                    id: "1",
                    name: "Wait",
                    args: {
                        type: 4,
                        time: 1,
                    },
                },
            };

            const diagnostics = collectNodeFieldCheckDiagnostics({
                tree,
                treePath: `${workdir}/main.json`,
                env,
                checkers: new Map(),
                visibles: new Map(),
            });

            assert.equal(diagnostics.length, 1);
            assert.equal(diagnostics[0]?.fieldKind, "arg");
            assert.equal(diagnostics[0]?.fieldName, "time");
            assert.match(diagnostics[0]?.message ?? "", /args\.typexxx/);
            assert.match(diagnostics[0]?.message ?? "", /defined arg scope/);

            const visibility = resolveNodeFieldVisibility({
                tree,
                treePath: `${workdir}/main.json`,
                env,
                visibles: new Map(),
                target: {
                    uuid: "root",
                    id: "1",
                    name: "Wait",
                    args: {
                        type: 4,
                        time: 1,
                    },
                },
            });

            assert.deepEqual(visibility, { args: {}, input: {}, output: {} });
            assert.equal(warnings.length, 1);
            assert.match(warnings[0] ?? "", /args\.typexxx/);
            assert.match(warnings[0] ?? "", /defined arg scope/);
        },
    },
    {
        name: "localizes visible expression diagnostics using the configured language",
        run() {
            const warnings: string[] = [];
            const workdir = "/work";
            const visibleExpression = "args.typexxx == 4";
            const env = {
                fs,
                path: b3path,
                workdir,
                allowNewFunction: true,
                language: "zh",
                nodeDefs: new Map([
                    [
                        "Wait",
                        {
                            name: "Wait",
                            type: "Action",
                            desc: "",
                            args: [
                                {
                                    name: "type",
                                    type: "int",
                                    desc: "",
                                },
                                {
                                    name: "health",
                                    type: "int",
                                    desc: "",
                                },
                                {
                                    name: "time",
                                    type: "float",
                                    desc: "",
                                    visible: visibleExpression,
                                },
                            ],
                        },
                    ],
                ]),
                logger: {
                    log() {},
                    debug() {},
                    info() {},
                    warn: (...args: unknown[]) => warnings.push(args.map(String).join(" ")),
                    error() {},
                },
            };

            const tree = {
                ...createTestTree(),
                root: {
                    uuid: "root",
                    id: "1",
                    name: "Wait",
                    args: {
                        type: 4,
                        health: 100,
                        time: 1,
                    },
                },
            };

            const diagnostics = collectNodeFieldCheckDiagnostics({
                tree,
                treePath: `${workdir}/main.json`,
                env,
                checkers: new Map(),
                visibles: new Map(),
            });

            assert.equal(diagnostics.length, 1);
            assert.match(diagnostics[0]?.message ?? "", /不在已定义的参数范围内/);
            assert.match(diagnostics[0]?.message ?? "", /已定义参数：type、health/);

            const visibility = resolveNodeFieldVisibility({
                tree,
                treePath: `${workdir}/main.json`,
                env,
                visibles: new Map(),
                target: {
                    uuid: "root",
                    id: "1",
                    name: "Wait",
                    args: {
                        type: 4,
                        health: 100,
                        time: 1,
                    },
                },
            });

            assert.deepEqual(visibility, { args: {}, input: {}, output: {} });
            assert.equal(warnings.length, 1);
            assert.match(warnings[0] ?? "", /不在已定义的参数范围内/);
        },
    },
    {
        name: "reports visible expression compile failures as field diagnostics",
        run() {
            const warnings: string[] = [];
            const workdir = "/work";
            const visibleExpression = "args.type ==";
            const env = {
                fs,
                path: b3path,
                workdir,
                allowNewFunction: true,
                nodeDefs: new Map([
                    [
                        "Wait",
                        {
                            name: "Wait",
                            type: "Action",
                            desc: "",
                            args: [
                                {
                                    name: "type",
                                    type: "int",
                                    desc: "",
                                },
                                {
                                    name: "time",
                                    type: "float",
                                    desc: "",
                                    visible: visibleExpression,
                                },
                            ],
                        },
                    ],
                ]),
                logger: {
                    log() {},
                    debug() {},
                    info() {},
                    warn: (...args: unknown[]) => warnings.push(args.map(String).join(" ")),
                    error() {},
                },
            };

            const tree = {
                ...createTestTree(),
                root: {
                    uuid: "root",
                    id: "1",
                    name: "Wait",
                    args: {
                        type: 4,
                        time: 1,
                    },
                },
            };

            const diagnostics = collectNodeFieldCheckDiagnostics({
                tree,
                treePath: `${workdir}/main.json`,
                env,
                checkers: new Map(),
                visibles: new Map(),
            });

            assert.equal(diagnostics.length, 1);
            assert.match(diagnostics[0]?.message ?? "", /failed to compile/);

            const visibility = resolveNodeFieldVisibility({
                tree,
                treePath: `${workdir}/main.json`,
                env,
                visibles: new Map(),
                target: {
                    uuid: "root",
                    id: "1",
                    name: "Wait",
                    args: {
                        type: 4,
                        time: 1,
                    },
                },
            });

            assert.deepEqual(visibility, { args: {}, input: {}, output: {} });
            assert.equal(warnings.length, 1);
            assert.match(warnings[0] ?? "", /failed to compile/);
        },
    },
    {
        name: "reports visible expression runtime failures as field diagnostics",
        run() {
            const warnings: string[] = [];
            const workdir = "/work";
            const visibleExpression = "args.type.name == 4";
            const env = {
                fs,
                path: b3path,
                workdir,
                allowNewFunction: true,
                nodeDefs: new Map([
                    [
                        "Wait",
                        {
                            name: "Wait",
                            type: "Action",
                            desc: "",
                            args: [
                                {
                                    name: "type",
                                    type: "int?",
                                    desc: "",
                                },
                                {
                                    name: "time",
                                    type: "float",
                                    desc: "",
                                    visible: visibleExpression,
                                },
                            ],
                        },
                    ],
                ]),
                logger: {
                    log() {},
                    debug() {},
                    info() {},
                    warn: (...args: unknown[]) => warnings.push(args.map(String).join(" ")),
                    error() {},
                },
            };

            const tree = {
                ...createTestTree(),
                root: {
                    uuid: "root",
                    id: "1",
                    name: "Wait",
                    args: {
                        time: 1,
                    },
                },
            };

            const diagnostics = collectNodeFieldCheckDiagnostics({
                tree,
                treePath: `${workdir}/main.json`,
                env,
                checkers: new Map(),
                visibles: new Map(),
            });

            assert.equal(diagnostics.length, 1);
            assert.match(diagnostics[0]?.message ?? "", /visible expression failed/i);

            const visibility = resolveNodeFieldVisibility({
                tree,
                treePath: `${workdir}/main.json`,
                env,
                visibles: new Map(),
                target: {
                    uuid: "root",
                    id: "1",
                    name: "Wait",
                    args: {
                        time: 1,
                    },
                },
            });

            assert.deepEqual(visibility, { args: {}, input: {}, output: {} });
            assert.equal(warnings.length, 1);
            assert.match(warnings[0] ?? "", /visible expression failed/i);
        },
    },
    {
        name: "ignores non-checker modules matched by workspace checkScripts",
        async run() {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-mixed-check-scripts-"));
            const scriptsDir = path.join(root, "scripts");
            const workdir = root.replace(/\\/g, "/");
            const buildScriptFile = path.join(scriptsDir, "build.ts");
            const checkerFile = path.join(scriptsDir, "positive.ts");
            const noop = () => {};

            try {
                fs.mkdirSync(scriptsDir, { recursive: true });
                fs.writeFileSync(
                    buildScriptFile,
                    [
                        "@behavior3.build",
                        "export class BuildScript {",
                        "  onProcessTree(tree) {",
                        "    return tree;",
                        "  }",
                        "}",
                        "",
                    ].join("\n")
                );
                fs.writeFileSync(
                    checkerFile,
                    [
                        '@behavior3.check("positive")',
                        "export class PositiveChecker {",
                        "  validate(value) {",
                        "    if (typeof value !== 'number' || value <= 0) {",
                        "      return 'must be greater than 0';",
                        "    }",
                        "  }",
                        "}",
                        "",
                    ].join("\n")
                );

                const resolved = resolveCheckScriptPaths(workdir, ["scripts/**/*.ts"]);
                assert.deepEqual(resolved.missingPatterns, []);
                assert.deepEqual(resolved.paths.map((entry) => path.basename(entry)).sort(), [
                    "build.ts",
                    "positive.ts",
                ]);

                const checkScriptModules = [] as { path: string; moduleExports: unknown }[];
                for (const scriptPath of resolved.paths) {
                    const moduleExports = await loadRuntimeModule(scriptPath, { debug: false });
                    assert.ok(moduleExports, `expected runtime module for ${scriptPath}`);
                    checkScriptModules.push({ path: scriptPath, moduleExports });
                }

                const runtime = createBuildScriptRuntimeWithCheckModules(null, checkScriptModules, {
                    fs,
                    path: b3path,
                    workdir,
                    nodeDefs: new Map([
                        [
                            "Wait",
                            {
                                name: "Wait",
                                type: "Action",
                                desc: "",
                                args: [
                                    {
                                        name: "time",
                                        type: "float",
                                        desc: "",
                                        checker: "positive",
                                    },
                                ],
                            },
                        ],
                    ]),
                    logger: {
                        log: noop,
                        debug: noop,
                        info: noop,
                        warn: noop,
                        error: noop,
                    },
                });

                assert.equal(runtime.hasError, false);
                assert.equal(runtime.nodeFieldCheckers.has("positive"), true);

                const diagnostics = collectNodeFieldCheckDiagnostics({
                    tree: {
                        version: "2.0.0",
                        name: "main",
                        prefix: "",
                        group: [],
                        variables: {
                            imports: [],
                            locals: [],
                        },
                        custom: {},
                        overrides: {},
                        root: {
                            uuid: "root",
                            id: "1",
                            name: "Wait",
                            args: {
                                time: 0,
                            },
                        },
                    },
                    treePath: `${workdir}/main.json`,
                    env: {
                        fs,
                        path: b3path,
                        workdir,
                        nodeDefs: new Map([
                            [
                                "Wait",
                                {
                                    name: "Wait",
                                    type: "Action",
                                    desc: "",
                                    args: [
                                        {
                                            name: "time",
                                            type: "float",
                                            desc: "",
                                            checker: "positive",
                                        },
                                    ],
                                },
                            ],
                        ]),
                        logger: {
                            log: noop,
                            debug: noop,
                            info: noop,
                            warn: noop,
                            error: noop,
                        },
                    },
                    checkers: runtime.nodeFieldCheckers,
                });

                assert.deepEqual(diagnostics, [
                    {
                        instanceKey: undefined,
                        nodeId: "1",
                        nodeName: "Wait",
                        fieldKind: "arg",
                        fieldName: "time",
                        checker: "positive",
                        message: "must be greater than 0",
                    },
                ]);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
    },
    {
        name: "cleans TypeScript build script runtime modules after debug builds",
        async run() {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-build-debug-"));
            const scriptsDir = path.join(root, "scripts");
            const workspaceFile = path.join(root, "workspace.b3-workspace");
            const settingFile = path.join(root, "node-config.b3-setting");
            const treeFile = path.join(root, "main.json");
            const buildScriptFile = path.join(scriptsDir, "build.ts");
            const helperFile = path.join(scriptsDir, "helper.ts");
            const outputDir = path.join(root, "dist");
            const previousDebug = process.env.BEHAVIOR3_BUILD_DEBUG;

            try {
                process.env.BEHAVIOR3_BUILD_DEBUG = "1";
                fs.mkdirSync(scriptsDir, { recursive: true });
                fs.writeFileSync(
                    workspaceFile,
                    JSON.stringify({
                        settings: {
                            buildScript: "scripts/build.ts",
                        },
                    })
                );
                fs.writeFileSync(
                    settingFile,
                    JSON.stringify([
                        {
                            name: "Root",
                            type: "Composite",
                            desc: "",
                            children: -1,
                        },
                    ])
                );
                fs.writeFileSync(
                    treeFile,
                    JSON.stringify({
                        version: "2.0.0",
                        name: "main",
                        prefix: "",
                        group: [],
                        variables: {
                            imports: [],
                            locals: [],
                        },
                        custom: {},
                        overrides: {},
                        root: {
                            uuid: "root",
                            id: "1",
                            name: "Root",
                            children: [],
                        },
                    })
                );
                fs.writeFileSync(
                    helperFile,
                    [
                        'export const debugValue = "debug-helper";',
                        "export function markTree(tree) {",
                        "  tree.custom = { ...(tree.custom ?? {}), debugValue };",
                        "}",
                        "",
                    ].join("\n")
                );
                fs.writeFileSync(
                    buildScriptFile,
                    [
                        'import { markTree } from "./helper.ts";',
                        "",
                        "export class Hook {",
                        "  onProcessTree(tree) {",
                        "    markTree(tree);",
                        "    return tree;",
                        "  }",
                        "}",
                        "",
                    ].join("\n")
                );

                const result = await buildBehaviorProject({
                    projectPath: treeFile,
                    outputDir,
                });
                const outputTree = JSON.parse(
                    fs.readFileSync(path.join(outputDir, "main.json"), "utf-8")
                );
                const runtimeFiles = fs
                    .readdirSync(scriptsDir)
                    .filter((file) => file.includes(".runtime.") && file.endsWith(".mjs"));

                assert.equal(result.hasError, false);
                assert.equal(outputTree.custom.debugValue, "debug-helper");
                assert.deepEqual(runtimeFiles, []);
            } finally {
                if (previousDebug === undefined) {
                    delete process.env.BEHAVIOR3_BUILD_DEBUG;
                } else {
                    process.env.BEHAVIOR3_BUILD_DEBUG = previousDebug;
                }
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
    },
    {
        name: "rejects legacy function-style build scripts",
        async run() {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior3-build-hook-"));
            const workspaceFile = path.join(root, "workspace.b3-workspace");
            const settingFile = path.join(root, "node-config.b3-setting");
            const treeFile = path.join(root, "main.json");
            const buildScriptFile = path.join(root, "legacy-build.js");
            const outputDir = path.join(root, "dist");

            try {
                fs.writeFileSync(
                    workspaceFile,
                    JSON.stringify({
                        settings: {
                            buildScript: "legacy-build.js",
                        },
                    })
                );
                fs.writeFileSync(
                    settingFile,
                    JSON.stringify([
                        {
                            name: "Root",
                            type: "Composite",
                            desc: "",
                            children: -1,
                        },
                    ])
                );
                fs.writeFileSync(
                    treeFile,
                    JSON.stringify({
                        version: "2.0.0",
                        name: "main",
                        prefix: "",
                        group: [],
                        variables: {
                            imports: [],
                            locals: [],
                        },
                        custom: {},
                        overrides: {},
                        root: {
                            uuid: "root",
                            id: "1",
                            name: "Root",
                            children: [],
                        },
                    })
                );
                fs.writeFileSync(
                    buildScriptFile,
                    ["export function onProcessTree(tree) {", "  return tree;", "}", ""].join("\n")
                );

                const result = await buildBehaviorProject({
                    projectPath: treeFile,
                    outputDir,
                });

                assert.equal(result.hasError, true);
                assert.equal(fs.existsSync(path.join(outputDir, "main.json")), true);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
    },
]);
