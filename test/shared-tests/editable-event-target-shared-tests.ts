import assert from "node:assert/strict";
import { isEditableEventTarget } from "../../webview/shared/editable-event-target";
import { defineSharedTests } from "../shared-test-types";

type MockTargetOptions = {
    tagName?: string;
    isContentEditable?: boolean;
    role?: string;
    closestMatches?: string[];
};

const createMockTarget = ({
    tagName,
    isContentEditable = false,
    role,
    closestMatches = [],
}: MockTargetOptions) => ({
    tagName,
    isContentEditable,
    getAttribute(name: string) {
        return name === "role" ? role ?? null : null;
    },
    closest(selector: string) {
        const selectors = selector.split(",").map((entry) => entry.trim());
        return selectors.some((entry) => closestMatches.includes(entry)) ? this : null;
    },
});

export const editableEventTargetSharedTests = defineSharedTests([
    {
        name: "treats native text inputs as editable event targets",
        run() {
            assert.equal(isEditableEventTarget(createMockTarget({ tagName: "input" })), true);
            assert.equal(isEditableEventTarget(createMockTarget({ tagName: "textarea" })), true);
            assert.equal(
                isEditableEventTarget(createMockTarget({ isContentEditable: true })),
                true
            );
        },
    },
    {
        name: "treats semantic textbox and combobox roles as editable event targets",
        run() {
            assert.equal(isEditableEventTarget(createMockTarget({ role: "textbox" })), true);
            assert.equal(isEditableEventTarget(createMockTarget({ role: "combobox" })), true);
            assert.equal(isEditableEventTarget(createMockTarget({ role: "searchbox" })), true);
        },
    },
    {
        name: "treats ant design composite inputs as editable event targets",
        run() {
            assert.equal(
                isEditableEventTarget(createMockTarget({ closestMatches: [".ant-select"] })),
                true
            );
            assert.equal(
                isEditableEventTarget(
                    createMockTarget({ closestMatches: [".ant-input-number"] })
                ),
                true
            );
            assert.equal(
                isEditableEventTarget(
                    createMockTarget({ closestMatches: [".ant-picker-dropdown"] })
                ),
                true
            );
        },
    },
    {
        name: "does not treat plain containers as editable event targets",
        run() {
            assert.equal(isEditableEventTarget(null), false);
            assert.equal(isEditableEventTarget(createMockTarget({ tagName: "div" })), false);
            assert.equal(isEditableEventTarget({}), false);
        },
    },
]);
