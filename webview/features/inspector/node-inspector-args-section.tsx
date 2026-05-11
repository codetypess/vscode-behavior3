import { Form, Input, InputNumber, Select, Switch } from "antd";
import type { FormInstance } from "antd/es/form";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
    checkOneof,
    getNodeArgOptions,
    getNodeArgRawType,
    isNodeArgArray,
    isNodeArgOptional,
    parseSlotDefinition,
} from "../../shared/node-utils";
import {
    hasArgOptions,
    isBoolType,
    isFloatType,
    isIntType,
    isJsonType,
    isStringType,
    type NodeArg,
    type NodeDef,
    type VarDecl,
} from "../../shared/b3type";
import type { NodeCheckDiagnostic } from "../../shared/contracts";
import { isRequiredNodeArgValueMissing } from "../../shared/validation";
import { parseArgSubmitValue, validateInspectorArgValue } from "./inspector-arg-values";
import {
    OverrideBar,
    SectionDivider,
    createInspectorLabelProps,
    createInspectorSwitchLabelProps,
    filterOptionByLabel,
} from "./inspector-shared";
import { compareJsonValue } from "./inspector-validation";

const { TextArea } = Input;

const NodeArgField: React.FC<{
    form: FormInstance;
    arg: NodeArg;
    nodeDef: NodeDef;
    committedArgValue: unknown;
    usingVars: Record<string, VarDecl> | null;
    checkExpr: boolean;
    nodeCheckDiagnostics: NodeCheckDiagnostic[];
    disabled: boolean;
    onCommit: () => void;
    onQueueCommit: () => void;
}> = ({
    form,
    arg,
    nodeDef,
    committedArgValue,
    usingVars,
    checkExpr,
    nodeCheckDiagnostics,
    disabled,
    onCommit,
    onQueueCommit,
}) => {
    const { t } = useTranslation();
    const argsValue = (Form.useWatch("args", form) as Record<string, unknown> | undefined) ?? {};
    const type = getNodeArgRawType(arg);
    const options = useMemo(() => getNodeArgOptions(arg, argsValue) ?? [], [arg, argsValue]);
    const required = !isNodeArgOptional(arg);
    const argLabel = arg.desc || arg.name;
    const argLabelProps = {
        ...createInspectorLabelProps(argLabel, required),
        required,
    };

    const validateField = async (_: unknown, value: unknown) => {
        const empty = isRequiredNodeArgValueMissing(arg, value);

        if (empty && !required) {
            return;
        }

        if (empty && required) {
            throw new Error(t("fieldRequired", { field: arg.desc || arg.name }));
        }

        let parsedValue: unknown = value;

        if (isNodeArgArray(arg) || isJsonType(type)) {
            parsedValue = parseArgSubmitValue(arg, value);
        }

        const validationError = validateInspectorArgValue({
            arg,
            rawValue: value,
            usingVars,
            checkExpr,
        });
        if (validationError) {
            throw new Error(validationError);
        }

        if (arg.oneof) {
            const relatedInputIndex =
                nodeDef.input?.findIndex(
                    (input, index) =>
                        parseSlotDefinition(input, nodeDef.input, index).label === arg.oneof
                ) ?? -1;

            if (relatedInputIndex < 0) {
                throw new Error(t("validation.missingOneofInput", { input: arg.oneof }));
            }

            const relatedInputValue = form.getFieldValue(["inputSlots", relatedInputIndex]);
            if (!checkOneof(arg, parsedValue, relatedInputValue)) {
                throw new Error(t("validation.oneof", { left: arg.name, right: arg.oneof }));
            }
        }

        const customDiagnostic = nodeCheckDiagnostics.find((entry) => entry.argName === arg.name);
        if (customDiagnostic && compareJsonValue(parsedValue, committedArgValue)) {
            throw new Error(customDiagnostic.message);
        }
    };

    if (isBoolType(type)) {
        return (
            <Form.Item
                {...createInspectorSwitchLabelProps(argLabel, required)}
                name={["args", arg.name]}
                valuePropName="checked"
                rules={[{ validator: validateField }]}
            >
                <Switch disabled={disabled} onChange={onQueueCommit} />
            </Form.Item>
        );
    }

    if (hasArgOptions(arg)) {
        return (
            <Form.Item
                {...argLabelProps}
                name={["args", arg.name]}
                rules={[{ validator: validateField }]}
            >
                <Select
                    mode={isNodeArgArray(arg) ? "multiple" : undefined}
                    disabled={disabled}
                    allowClear={!required}
                    onChange={onQueueCommit}
                    onBlur={onCommit}
                    options={options.map((option: { name: string; value: unknown }) => ({
                        label: `${option.name} (${String(option.value)})`,
                        value: option.value as string | number | boolean,
                    }))}
                    filterOption={filterOptionByLabel}
                />
            </Form.Item>
        );
    }

    if (isNodeArgArray(arg) || isJsonType(type)) {
        return (
            <Form.Item
                {...argLabelProps}
                name={["args", arg.name]}
                rules={[{ validator: validateField }]}
            >
                <TextArea
                    autoSize={{ minRows: 1 }}
                    disabled={disabled}
                    placeholder={
                        isNodeArgArray(arg) ? t("form.enterJsonArray") : t("form.enterJsonValue")
                    }
                    onBlur={onCommit}
                />
            </Form.Item>
        );
    }

    if (isIntType(type) || isFloatType(type)) {
        return (
            <Form.Item
                {...argLabelProps}
                name={["args", arg.name]}
                rules={[{ validator: validateField }]}
            >
                <InputNumber
                    style={{ width: "100%" }}
                    disabled={disabled}
                    precision={isIntType(type) ? 0 : undefined}
                    onBlur={onCommit}
                />
            </Form.Item>
        );
    }

    if (isStringType(type)) {
        return (
            <Form.Item
                {...argLabelProps}
                name={["args", arg.name]}
                rules={[{ validator: validateField }]}
            >
                <TextArea autoSize={{ minRows: 1 }} disabled={disabled} onBlur={onCommit} />
            </Form.Item>
        );
    }

    return (
        <Form.Item
            {...argLabelProps}
            name={["args", arg.name]}
            rules={[{ validator: validateField }]}
        >
            <Input disabled={disabled} onBlur={onCommit} />
        </Form.Item>
    );
};

export const NodeStructuredArgsSection: React.FC<{
    form: FormInstance;
    nodeDef: NodeDef;
    args: NodeArg[];
    committedArgs: Record<string, unknown> | undefined;
    usingVars: Record<string, VarDecl> | null;
    checkExpr: boolean;
    nodeCheckDiagnostics: NodeCheckDiagnostic[];
    fieldEditDisabled: boolean;
    isOverridden: (argName: string) => boolean;
    onReset: (arg: NodeArg) => void;
    onCommit: (arg: NodeArg) => void;
    onQueueCommit: (arg: NodeArg) => void;
}> = ({
    form,
    nodeDef,
    args,
    committedArgs,
    usingVars,
    checkExpr,
    nodeCheckDiagnostics,
    fieldEditDisabled,
    isOverridden,
    onReset,
    onCommit,
    onQueueCommit,
}) => {
    const { t } = useTranslation();

    if (args.length === 0) {
        return null;
    }

    return (
        <>
            <SectionDivider>{t("node.args")}</SectionDivider>
            {args.map((arg) => (
                <OverrideBar
                    key={`arg-${arg.name}`}
                    active={isOverridden(arg.name)}
                    onReset={() => onReset(arg)}
                >
                    <NodeArgField
                        form={form}
                        arg={arg}
                        nodeDef={nodeDef}
                        committedArgValue={committedArgs?.[arg.name]}
                        usingVars={usingVars}
                        checkExpr={checkExpr}
                        nodeCheckDiagnostics={nodeCheckDiagnostics}
                        disabled={fieldEditDisabled}
                        onCommit={() => onCommit(arg)}
                        onQueueCommit={() => onQueueCommit(arg)}
                    />
                </OverrideBar>
            ))}
        </>
    );
};
