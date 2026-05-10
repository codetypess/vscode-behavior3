import assert from "node:assert/strict";
import {
    getNewerFileEditMessage,
    getNewerFileVersion,
    getTreeFileVersion,
} from "../../src/editor-session/session-file-version";
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
            assert.equal(getNewerFileEditMessage("en", `{"version":"0.0.1"}`), null);
        },
    },
]);
