import { AimOutlined, MinusCircleOutlined } from "@ant-design/icons";
import { Divider, Flex, Input, Popconfirm, Space } from "antd";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    isExprType,
    type NodeDef,
    type VarDecl,
} from "../../shared/misc/b3type";
import {
    dfs,
    getNodeArgRawType,
    hasDeclaredVars,
    isVariadic,
    parseExpr,
} from "../../shared/misc/b3util";
import i18n from "../../shared/misc/i18n";
import {
    validateExpressionEntries,
    validateVariableReference,
    type TreeValidationDiagnostic,
} from "../../domain/tree-validation";
import { useInspectorMode } from "./inspector-mode";

export type VariableOption = {
    label: string;
    value: string;
};

export type VariableRowValue = VarDecl & {
    count?: number;
};

type VariableUsageNode = {
    name: string;
    args?: Record<string, unknown>;
    input?: string[];
    output?: string[];
    children?: VariableUsageNode[];
};

export const queueInspectorTask = (task: () => void) => {
    window.setTimeout(() => {
        task();
    }, 0);
};

const pendingInspectorEdits = new Set<Promise<unknown>>();

export const trackPendingInspectorEdit = (promise: Promise<unknown>): void => {
    const tracked = promise
        .catch(() => undefined)
        .finally(() => {
            pendingInspectorEdits.delete(tracked);
        });
    pendingInspectorEdits.add(tracked);
};

const waitForPendingInspectorEdits = async (): Promise<void> => {
    while (pendingInspectorEdits.size > 0) {
        await Promise.allSettled([...pendingInspectorEdits]);
    }
};

export const flushPendingInspectorEdits = async (): Promise<void> => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) {
        active.blur();
    }

    await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 0);
    });
    await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 0);
    });
    await waitForPendingInspectorEdits();
};

export const cleanSlotLabel = (value: string) => value.replace(/\?$/, "").replace(/\.\.\.$/, "");

export const createNodeDefMap = (nodeDefs: NodeDef[]) => {
    const map = new Map<string, NodeDef>();
    for (const nodeDef of nodeDefs) {
        map.set(nodeDef.name, nodeDef);
    }
    return map;
};

export const buildVariableUsageCount = (
    root: VariableUsageNode | null,
    nodeDefMap: Map<string, NodeDef>
) => {
    const count: Record<string, number> = {};

    if (!root) {
        return count;
    }

    dfs(root, (node) => {
        const nodeDef = nodeDefMap.get(node.name);
        if (!nodeDef) {
            return;
        }

        node.input?.forEach((variable) => {
            if (!variable) {
                return;
            }
            count[variable] = (count[variable] ?? 0) + 1;
        });

        node.output?.forEach((variable) => {
            if (!variable) {
                return;
            }
            count[variable] = (count[variable] ?? 0) + 1;
        });

        nodeDef.args?.forEach((arg) => {
            if (!isExprType(getNodeArgRawType(arg))) {
                return;
            }
            const rawValue = node.args?.[arg.name];
            const entries = Array.isArray(rawValue) ? rawValue : [rawValue];
            entries.forEach((entry) => {
                if (typeof entry !== "string" || !entry) {
                    return;
                }
                parseExpr(entry).forEach((variable) => {
                    count[variable] = (count[variable] ?? 0) + 1;
                });
            });
        });
    });

    return count;
};

export const createVariableOptions = (
    usingVars: Record<string, VarDecl> | null,
    root: VariableUsageNode | null,
    nodeDefMap: Map<string, NodeDef>
): VariableOption[] => {
    const options: VariableOption[] = [];
    const seen = new Set<string>();

    if (hasDeclaredVars(usingVars)) {
        Object.values(usingVars).forEach((variable) => {
            if (seen.has(variable.name)) {
                return;
            }
            seen.add(variable.name);
            options.push({
                label: `${variable.name} (${variable.desc})`,
                value: variable.name,
            });
        });
        return options;
    }

    if (!root) {
        return options;
    }

    dfs(root, (node) => {
        const nodeDef = nodeDefMap.get(node.name);

        node.input?.forEach((variable, index) => {
            if (!variable || seen.has(variable)) {
                return;
            }
            const rawLabel =
                nodeDef?.input?.length &&
                index >= nodeDef.input.length &&
                isVariadic(nodeDef.input, -1)
                    ? nodeDef.input[nodeDef.input.length - 1]
                    : (nodeDef?.input?.[index] ?? "input");
            seen.add(variable);
            options.push({
                label: `${variable} (${cleanSlotLabel(rawLabel)})`,
                value: variable,
            });
        });

        node.output?.forEach((variable, index) => {
            if (!variable || seen.has(variable)) {
                return;
            }
            const rawLabel =
                nodeDef?.output?.length &&
                index >= nodeDef.output.length &&
                isVariadic(nodeDef.output, -1)
                    ? nodeDef.output[nodeDef.output.length - 1]
                    : (nodeDef?.output?.[index] ?? "output");
            seen.add(variable);
            options.push({
                label: `${variable} (${cleanSlotLabel(rawLabel)})`,
                value: variable,
            });
        });
    });

    return options;
};

export const formatChildrenLabel = (nodeDef: NodeDef | null) => {
    if (!nodeDef) {
        return "-";
    }
    if (nodeDef.children === undefined || nodeDef.children === -1) {
        return i18n.t("node.children.unlimited");
    }
    return String(nodeDef.children);
};

export const compareJsonValue = (left: unknown, right: unknown) =>
    JSON.stringify(left) === JSON.stringify(right);

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

export const filterOptionByLabel = (input: string, option?: { label?: React.ReactNode }) =>
    String(option?.label ?? "")
        .toUpperCase()
        .includes(input.toUpperCase());

const getOverridePopupContainer = (trigger: HTMLElement) => {
    return (trigger.closest(".b3-inspector") as HTMLElement) ?? document.body;
};

export const OverrideBar: React.FC<{
    active: boolean;
    onReset: () => void;
    children: React.ReactNode;
}> = ({ active, onReset, children }) => {
    const { t } = useTranslation();
    const { readOnly } = useInspectorMode();

    if (!active || readOnly) {
        return <>{children}</>;
    }

    return (
        <div className="b3-override-bar">
            <Popconfirm
                title={t("override.resetTitle")}
                okText={t("reset")}
                cancelText={t("cancel")}
                placement="left"
                onConfirm={onReset}
                getPopupContainer={getOverridePopupContainer}
            >
                <div className="b3-override-rail" />
            </Popconfirm>
            {children}
        </div>
    );
};

export const SectionDivider: React.FC<React.PropsWithChildren> = ({ children }) => {
    return (
        <Divider className="b3-section-divider" titlePlacement="start" orientation="horizontal">
            <h4 className="b3-section-title">{children}</h4>
        </Divider>
    );
};

export const InspectorLabel: React.FC<{ text: string; required?: boolean }> = ({
    text,
    required,
}) => {
    return (
        <span className="b3-form-label">
            <span className="b3-form-label-text">
                {required ? <span className="b3-form-required-mark">*</span> : null}
                {text}
            </span>
            <span className="b3-form-label-colon">:</span>
        </span>
    );
};

export const createInspectorLabelProps = (text: string, required = false) => ({
    label: <InspectorLabel text={text} required={required} />,
    colon: false as const,
});

export const VariableDeclRow: React.FC<{
    value?: VariableRowValue;
    disabled?: boolean;
    onChange?: (next: VariableRowValue) => void;
    onRemove?: () => void;
    onSubmit?: () => void;
    onFocusVariable?: (name: string) => void;
}> = ({ value, disabled = false, onChange, onRemove, onSubmit, onFocusVariable }) => {
    const { t } = useTranslation();
    const [localValue, setLocalValue] = useState<VariableRowValue>(value ?? { name: "", desc: "" });

    useEffect(() => {
        setLocalValue(value ?? { name: "", desc: "" });
    }, [value]);

    const commit = () => {
        onChange?.(localValue);
        onSubmit?.();
    };

    return (
        <Flex gap={4} align="start" className="b3-var-row">
            <Space.Compact block className="b3-var-row-compact">
                <div
                    className="b3-var-counter"
                    onClick={() => {
                        if (localValue.name) {
                            onFocusVariable?.(localValue.name);
                        }
                    }}
                >
                    <AimOutlined />
                    <span>{localValue.count ?? 0}</span>
                </div>
                <Input
                    disabled={disabled}
                    value={localValue.name}
                    placeholder={t("tree.vars.name")}
                    onChange={(event) =>
                        setLocalValue((current) => ({
                            ...current,
                            name: event.target.value,
                        }))
                    }
                    onBlur={commit}
                />
                <Input
                    disabled={disabled}
                    value={localValue.desc}
                    placeholder={t("tree.vars.desc")}
                    onChange={(event) =>
                        setLocalValue((current) => ({
                            ...current,
                            desc: event.target.value,
                        }))
                    }
                    onBlur={commit}
                />
            </Space.Compact>
            {disabled ? (
                <div className="b3-row-spacer" />
            ) : (
                <MinusCircleOutlined className="b3-inline-remove" onClick={onRemove} />
            )}
        </Flex>
    );
};
