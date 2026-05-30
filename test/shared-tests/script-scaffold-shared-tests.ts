import assert from "node:assert/strict";
import {
    createScriptScaffoldContent,
    createScriptScaffoldFileName,
    getScriptScaffoldDefaultBaseName,
    validateScriptScaffoldBaseName,
} from "../../src/script-scaffold";
import { defineSharedTests } from "../shared-test-types";

export const scriptScaffoldSharedTests = defineSharedTests([
    {
        name: "validates scaffold file names and default base names",
        run() {
            assert.equal(getScriptScaffoldDefaultBaseName("build"), "build");
            assert.equal(getScriptScaffoldDefaultBaseName("batch"), "batch");
            assert.equal(getScriptScaffoldDefaultBaseName("checker"), "checker");
            assert.equal(validateScriptScaffoldBaseName(""), "Name cannot be empty");
            assert.equal(
                validateScriptScaffoldBaseName("batch.ts"),
                "Enter the name without an extension"
            );
            assert.equal(
                validateScriptScaffoldBaseName("bad/name"),
                "Name contains invalid characters"
            );
            assert.equal(validateScriptScaffoldBaseName("good-name"), null);
            assert.equal(createScriptScaffoldFileName("good-name"), "good-name.ts");
        },
    },
    {
        name: "renders build and batch script scaffolds with split build and batch decorators",
        run() {
            const build = createScriptScaffoldContent("build", "my-build");
            assert.match(build, /@behavior3\.build/);
            assert.match(build, /implements BuildScript/);
            assert.match(build, /export class MyBuildScript/);
            assert.match(build, /onProcessTree/);
            assert.match(build, /onProcessNode/);

            const batch = createScriptScaffoldContent("batch", "batch");
            assert.match(batch, /@behavior3\.batch/);
            assert.match(batch, /implements BatchScript/);
            assert.match(batch, /export class BatchScript/);
            assert.match(batch, /shouldUpgradeTree/);
            assert.match(batch, /`batch \$\{status\}`/);
        },
    },
    {
        name: "renders checker scaffolds with normalized checker registration names",
        run() {
            const checker = createScriptScaffoldContent("checker", "Positive Rule");
            assert.match(checker, /@behavior3\.check\("positive-rule"\)/);
            assert.match(checker, /export class PositiveRuleChecker/);
            assert.match(checker, /ctx\.fieldName/);

            const fallback = createScriptScaffoldContent("checker", "行为");
            assert.match(fallback, /@behavior3\.check\("checker"\)/);
            assert.match(fallback, /export class GeneratedChecker/);
        },
    },
]);
