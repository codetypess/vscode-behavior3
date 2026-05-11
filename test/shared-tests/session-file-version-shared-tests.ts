import assert from "node:assert/strict";
import {
    getNewerFileEditMessage,
    getNewerFileVersion,
    getNewerVersionMessage,
    getTreeFileVersion,
} from "../../src/editor-session/document/file-version";
import { defineSharedTests } from "../shared-test-types";

export const sessionFileVersionSharedTests = defineSharedTests([
    {
        name: "extracts tree file versions only from valid string metadata",
        run() {
            assert.equal(getTreeFileVersion(`{"version":"2.0.0"}`), "2.0.0");
            assert.equal(getTreeFileVersion(`{"version":2}`), undefined);
            assert.equal(getTreeFileVersion(`not-json`), undefined);
        },
    },
    {
        name: "builds newer-file edit messages only for newer versions",
        run() {
            const newerContent = `{"version":"999.0.0"}`;
            assert.equal(getNewerFileVersion(newerContent), "999.0.0");
            assert.equal(
                getNewerFileEditMessage("en", newerContent),
                "This file is created by a newer version of Behavior3(999.0.0). Please upgrade to the latest version."
            );
            assert.equal(
                getNewerVersionMessage("zh", "999.0.0", "warn"),
                "此文件由新版本 Behavior3(999.0.0) 创建，请升级到最新版本。"
            );
            assert.equal(
                getNewerFileEditMessage("zh", newerContent),
                "此文件由新版本 Behavior3(999.0.0) 创建，请升级到最新版本后再编辑。"
            );
            assert.equal(getNewerFileEditMessage("en", `{"version":"0.0.1"}`), null);
        },
    },
]);
