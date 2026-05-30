import { ReloadOutlined } from "@ant-design/icons";
import { Flex, Form, Input, InputNumber, Popconfirm, Select, Switch } from "antd";
import type { FormInstance } from "antd/es/form";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
    getNodeArgOptions,
    getNodeArgRawType,
    isNodeArgArray,
    isNodeArgOptional,
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
import type { NodeFieldDiagnostic } from "../../shared/contracts";
import { isRequiredNodeArgValueMissing, validateNodeArgOneof } from "../../shared/validation";
import { parseArgSubmitValue, validateInspectorArgValue } from "./inspector-arg-values";
import {
    OverrideBar,
    SectionDivider,
    createInspectorLabelProps,
    filterOptionByLabel,
    getInspectorPopupContainer,
} from "./inspector-shared";
import { compareJsonValue, formatValidationDiagnostic } from "./inspector-validation";

const { TextArea } = Input;

const NodeArgField: React.FC<{
    form: FormInstance;
    arg: NodeArg;
    nodeDef: NodeDef;
    currentArgValue: unknown;
    usingVars: Record<string, VarDecl> | null;
    checkExpr: boolean;
    nodeFieldDiagnostics: NodeFieldDiagnostic[];
    disabled: boolean;
    showDefaultReset: boolean;
    onCommit: () => void;
    onQueueCommit: () => void;
    onResetToDefault: () => void;
}> = ({
    form,
    arg,
    nodeDef,
    currentArgValue,
    usingVars,
    checkExpr,
    nodeFieldDiagnostics,
    disabled,
    showDefaultReset,
    onCommit,
    onQueueCommit,
    onResetToDefault,
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

    const renderFieldItem = (control: React.ReactNode, valuePropName?: "checked") => {
        if (!showDefaultReset || disabled) {
            return (
                <Form.Item
                    {...argLabelProps}
                    name={["args", arg.name]}
                    valuePropName={valuePropName}
                    rules={[{ validator: validateField }]}
                >
                    {control}
                </Form.Item>
            );
        }

        return (
            <Form.Item {...argLabelProps} required={required}>
                <Flex gap={4} align="start" className="b3-field-with-action">
                    <div className="b3-field-with-action-control">
                        <Form.Item
                            noStyle
                            name={["args", arg.name]}
                            valuePropName={valuePropName}
                            rules={[{ validator: validateField }]}
                        >
                            {control}
                        </Form.Item>
                    </div>
                    <Popconfirm
                        title={t("reset.defaultConfirm")}
                        okText={t("reset")}
                        cancelText={t("cancel")}
                        placement="right"
                        onConfirm={onResetToDefault}
                        getPopupContainer={getInspectorPopupContainer}
                    >
                        <ReloadOutlined
                            className="b3-inline-reset"
                            title={t("reset")}
                            onMouseDown={(event) => event.preventDefault()}
                        />
                    </Popconfirm>
                </Flex>
            </Form.Item>
        );
    };

    const validateField = async (_: unknown, value: unknown) => {
        const empty = isRequiredNodeArgValueMissing(arg, value);

        if (empty && !required) {
            return;
        }

        if (empty && required) {
            throw new Error(t("fieldRequired", { field: arg.desc || arg.name }));
        }

        const parsedValue = parseArgSubmitValue(arg, value);

        const validationError = validateInspectorArgValue({
            arg,
            rawValue: value,
            usingVars,
            checkExpr,
        });
        if (validationError) {
            throw new Error(validationError);
        }

        const oneofDiagnostic = validateNodeArgOneof({
            arg,
            argValue: parsedValue,
            inputValues: form.getFieldValue("inputSlots"),
            inputDefs: nodeDef.input,
        });
        if (oneofDiagnostic) {
            throw new Error(formatValidationDiagnostic(oneofDiagnostic));
        }

        const customDiagnostic = nodeFieldDiagnostics.find(
            (entry) => entry.fieldKind === "arg" && entry.fieldName === arg.name
        );
        if (customDiagnostic && compareJsonValue(parsedValue, currentArgValue)) {
            throw new Error(customDiagnostic.message);
        }
    };

    if (isBoolType(type)) {
        return renderFieldItem(<Switch disabled={disabled} onChange={onQueueCommit} />, "checked");
    }

    if (hasArgOptions(arg)) {
        return renderFieldItem(
            <Select
                mode={isNodeArgArray(arg) ? "multiple" : undefined}
                disabled={disabled}
                allowClear={!required}
                showSearch
                onChange={onQueueCommit}
                onBlur={onCommit}
                options={options.map((option: { name: string; value: unknown }) => ({
                    label: `${option.name} (${String(option.value)})`,
                    value: option.value as string | number | boolean,
                }))}
                filterOption={filterOptionByLabel}
            />
        );
    }

    if (isNodeArgArray(arg) || isJsonType(type)) {
        return renderFieldItem(
            <TextArea
                autoSize={{ minRows: 1 }}
                disabled={disabled}
                placeholder={
                    isNodeArgArray(arg) ? t("form.enterJsonArray") : t("form.enterJsonValue")
                }
                onBlur={onCommit}
            />
        );
    }

    if (isIntType(type) || isFloatType(type)) {
        return renderFieldItem(
            <InputNumber
                style={{ width: "100%" }}
                disabled={disabled}
                precision={isIntType(type) ? 0 : undefined}
                onBlur={onCommit}
            />
        );
    }

    if (isStringType(type)) {
        return renderFieldItem(
            <TextArea autoSize={{ minRows: 1 }} disabled={disabled} onBlur={onCommit} />
        );
    }

    return renderFieldItem(<Input disabled={disabled} onBlur={onCommit} />);
};

export const NodeStructuredArgsSection: React.FC<{
    form: FormInstance;
    nodeDef: NodeDef;
    args: NodeArg[];
    effectiveArgs: Record<string, unknown> | undefined;
    usingVars: Record<string, VarDecl> | null;
    checkExpr: boolean;
    nodeFieldDiagnostics: NodeFieldDiagnostic[];
    fieldEditDisabled: boolean;
    isOverridden: (argName: string) => boolean;
    onReset: (arg: NodeArg) => void;
    onResetToDefault: (arg: NodeArg) => void;
    onCommit: (arg: NodeArg) => void;
    onQueueCommit: (arg: NodeArg) => void;
}> = ({
    form,
    nodeDef,
    args,
    effectiveArgs,
    usingVars,
    checkExpr,
    nodeFieldDiagnostics,
    fieldEditDisabled,
    isOverridden,
    onReset,
    onResetToDefault,
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
                        currentArgValue={effectiveArgs?.[arg.name]}
                        usingVars={usingVars}
                        checkExpr={checkExpr}
                        nodeFieldDiagnostics={nodeFieldDiagnostics}
                        disabled={fieldEditDisabled}
                        showDefaultReset={arg.default !== undefined}
                        onCommit={() => onCommit(arg)}
                        onQueueCommit={() => onQueueCommit(arg)}
                        onResetToDefault={() => onResetToDefault(arg)}
                    />
                </OverrideBar>
            ))}
        </>
    );
};
