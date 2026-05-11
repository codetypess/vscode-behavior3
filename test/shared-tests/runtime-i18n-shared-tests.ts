import assert from "node:assert/strict";
import { formatDocumentMutationReducerError } from "../../webview/shared/document";
import {
    normalizeI18nLanguage,
    translateRuntimeMessage,
} from "../../webview/shared/runtime-i18n";
import { defineSharedTests } from "../shared-test-types";

export const runtimeI18nSharedTests = defineSharedTests([
    {
        name: "normalizes runtime language and interpolates locale messages",
        run() {
            assert.equal(normalizeI18nLanguage("zh-CN"), "zh");
            assert.equal(normalizeI18nLanguage("en-US"), "en");
            assert.equal(
                translateRuntimeMessage("en", "alertNewVersion", { version: "999.0.0" }),
                "This file is created by a newer version of Behavior3(999.0.0), please upgrade to the latest version."
            );
            assert.equal(
                translateRuntimeMessage("zh", "mutation.invalidJsonPath", {
                    path: "foo/bar.json",
                }),
                "无效的 JSON 路径: foo/bar.json"
            );
        },
    },
    {
        name: "formats document mutation reducer errors through runtime translations",
        run() {
            assert.equal(
                formatDocumentMutationReducerError({ code: "missing-selected-node" }, "zh"),
                "当前没有可用于提交此修改的选中节点。"
            );
            assert.equal(
                formatDocumentMutationReducerError(
                    { code: "move-into-descendant-denied" },
                    "en"
                ),
                "Cannot move a node into its own descendant."
            );
        },
    },
]);
