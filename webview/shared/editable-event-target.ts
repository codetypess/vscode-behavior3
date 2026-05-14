type ClosestCapableTarget = {
    tagName?: string;
    isContentEditable?: boolean;
    closest?: (selector: string) => unknown;
    getAttribute?: (name: string) => string | null;
};

const editableRoles = new Set(["textbox", "combobox", "searchbox", "spinbutton"]);

const hasTagName = (target: ClosestCapableTarget, tagName: string) =>
    typeof target.tagName === "string" && target.tagName.toUpperCase() === tagName;

const matchesEditableRole = (target: ClosestCapableTarget) => {
    const role = target.getAttribute?.("role")?.toLowerCase();
    return Boolean(role && editableRoles.has(role));
};

const livesInsideEditableComposite = (target: ClosestCapableTarget) =>
    Boolean(
        target.closest?.(
            [
                ".ant-select",
                ".ant-select-dropdown",
                ".ant-picker",
                ".ant-picker-dropdown",
                ".ant-input-number",
                ".ant-input-affix-wrapper",
                ".ant-mentions",
                ".ant-mentions-dropdown",
            ].join(",")
        )
    );

export const isEditableEventTarget = (target: EventTarget | ClosestCapableTarget | null) => {
    if (!target || typeof target !== "object") {
        return false;
    }

    const candidate = target as ClosestCapableTarget;
    return (
        hasTagName(candidate, "INPUT") ||
        hasTagName(candidate, "TEXTAREA") ||
        Boolean(candidate.isContentEditable) ||
        matchesEditableRole(candidate) ||
        livesInsideEditableComposite(candidate)
    );
};
