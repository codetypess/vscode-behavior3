import { isJsonEqual } from "../../shared/equality";
import type { NodeDef } from "../../shared/misc/b3type";
import type { VarDecl } from "../../shared/misc/b3type";
import i18n from "../../shared/misc/i18n";
import {
    type TreeValidationDiagnostic,
    validateExpressionEntries,
    validateVariableReference,
} from "../../shared/validation";

export const cleanSlotLabel = (value: string) => value.replace(/\?$/, "").replace(/\.\.\.$/, "");

const formatValidationDiagnostic = (diagnostic: TreeValidationDiagnostic): string => {
    switch (diagnostic.code) {
        case "invalid-variable-name":
            return i18n.t("node.invalidVariableName");
        case "undefined-variable":
            return i18n.t("node.undefinedVariable", { variable: diagnostic.variable });
        case "invalid-expression":
            return i18n.t("node.invalidExpression");
        case "group-not-enabled":
            return i18n.t("node.groupNotEnabled", { group: diagnostic.groups.join(", ") });
        case "required-arg":
            return i18n.t("fieldRequired", { field: diagnostic.label });
        case "required-input":
        case "required-output":
            return i18n.t("fieldRequired", { field: diagnostic.label });
        case "custom-arg-check":
            return `${diagnostic.argName}: ${diagnostic.message}`;
        case "invalid-children":
            return i18n.t("node.invalidChildren");
        case "missing-node-def":
            return i18n.t("node.notFound", { name: diagnostic.nodeName });
        default:
            return i18n.t("node.invalidValue");
    }
};

export const compareJsonValue = isJsonEqual;

export const formatChildrenLabel = (nodeDef: NodeDef | null) => {
    if (!nodeDef) {
        return "-";
    }
    if (nodeDef.children === undefined || nodeDef.children === -1) {
        return i18n.t("node.children.unlimited");
    }
    return String(nodeDef.children);
};

export const validateVariableValue = (
    value: string | undefined,
    usingVars: Record<string, VarDecl> | null
): string | null => {
    const diagnostic = validateVariableReference(value, usingVars, "input");
    return diagnostic ? formatValidationDiagnostic(diagnostic) : null;
};

export const validateExpressionValues = (
    entries: string[],
    usingVars: Record<string, VarDecl> | null,
    checkExpr: boolean
): string | null => {
    const diagnostic = validateExpressionEntries(entries, usingVars, checkExpr);
    return diagnostic ? formatValidationDiagnostic(diagnostic) : null;
};
