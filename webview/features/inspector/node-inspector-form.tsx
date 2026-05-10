import { FormOutlined, MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { AutoComplete, Button, Flex, Form, Input, InputNumber, Select, Switch } from "antd";
import type { FormInstance } from "antd/es/form";
import React, { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import { canOpenSubtreeTarget } from "../../domain/subtree-navigation";
import { findNodeDef, parseSlotDefinition } from "../../shared/node-definition-utils";
import {
    hasArgOptions,
    isBoolType,
    isExprType,
    isFloatType,
    isIntType,
    isJsonType,
    isStringType,
    type NodeArg,
    type NodeDef,
    type VarDecl,
} from "../../shared/b3type";
import {
    checkOneof,
    getNodeArgOptions,
    getNodeArgRawType,
    isNodeArgArray,
    isNodeArgOptional,
} from "../../shared/node-arg-utils";
import { useRuntime } from "../../app/runtime";
import type { NodeCheckDiagnostic } from "../../shared/contracts";
import { isRequiredNodeArgValueMissing } from "../../domain/tree-validation";
import {
    parseArgSubmitValue,
    validateInspectorArgValue,
} from "./inspector-arg-values";
import {
    OverrideBar,
    SectionDivider,
    createInspectorLabelProps,
    createInspectorSwitchLabelProps,
    filterOptionByLabel,
} from "./inspector-shared";
import { compareJsonValue, validateVariableValue } from "./inspector-validation";
import type { VariableOption } from "./inspector-variable-options";
import { useNodeInspectorViewState } from "./inspector-state";
import {
    createNodeInspectorFormValues,
    type NodeInspectorFormValues,
} from "./inspector-form-values";
import { useInspectorMode } from "./inspector-mode";
import {
    type SlotFieldName,
    useNodeInspectorCommitters,
} from "./node-inspector-committers";

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

const NodeMetaFields: React.FC<{
    selectedNode: NonNullable<ReturnType<typeof useNodeInspectorViewState>["selectedNode"]>;
    nodeDefs: NodeDef[];
    nodeDef: NodeDef | null;
    nodeDefMap: ReadonlyMap<string, NodeDef>;
    usingGroups: Record<string, boolean> | null;
    allFiles: string[];
    fieldEditDisabled: boolean;
    readOnly: boolean;
    canShowOverride: boolean;
    subtreeOriginal: ReturnType<typeof useNodeInspectorViewState>["subtreeOriginal"];
    onCommitName: () => void;
    onQueueCommitName: () => void;
    onCommitDesc: () => void;
    onQueueCommitDebug: () => void;
    onQueueCommitDisabled: () => void;
    onCommitPath: () => void;
    onQueueCommitPath: () => void;
    onResetDesc: () => void;
    onResetDebug: () => void;
    onResetDisabled: () => void;
}> = ({
    selectedNode,
    nodeDefs,
    nodeDef,
    nodeDefMap,
    usingGroups,
    allFiles,
    fieldEditDisabled,
    readOnly,
    canShowOverride,
    subtreeOriginal,
    onCommitName,
    onQueueCommitName,
    onCommitDesc,
    onQueueCommitDebug,
    onQueueCommitDisabled,
    onCommitPath,
    onQueueCommitPath,
    onResetDesc,
    onResetDebug,
    onResetDisabled,
}) => {
    const { t } = useTranslation();
    const formatResolutionError = () => {
        switch (selectedNode.resolutionError) {
            case "missing-subtree":
                return t("node.subtreeMissing", { path: selectedNode.data.path ?? "" });
            case "invalid-subtree":
                return t("node.subtreeInvalid", { path: selectedNode.data.path ?? "" });
            case "cyclic-subtree":
                return t("node.subtreeCyclic", { path: selectedNode.data.path ?? "" });
            default:
                return null;
        }
    };

    return (
        <>
            <Form.Item {...createInspectorLabelProps(t("node.id"))} name="id">
                <Input disabled />
            </Form.Item>
            <Form.Item {...createInspectorLabelProps(t("node.type"))} name="type">
                <Input disabled />
            </Form.Item>

            {nodeDef?.group?.length ? (
                <Form.Item
                    {...createInspectorLabelProps(t("node.group"))}
                    name="group"
                    rules={[
                        {
                            validator: async () => {
                                if (!nodeDef.group?.some((group) => usingGroups?.[group])) {
                                    throw new Error(
                                        t("node.groupNotEnabled", {
                                            group: nodeDef.group,
                                        })
                                    );
                                }
                            },
                        },
                    ]}
                >
                    <Select
                        mode="multiple"
                        disabled
                        options={nodeDef.group.map((group) => ({
                            label: group,
                            value: group,
                        }))}
                    />
                </Form.Item>
            ) : null}

            <Form.Item
                {...createInspectorLabelProps(t("node.children"))}
                name="children"
                rules={[
                    {
                        validator: async () => {
                            if (
                                nodeDef?.children !== undefined &&
                                nodeDef.children !== -1 &&
                                selectedNode.activeChildCount !== nodeDef.children
                            ) {
                                throw new Error(t("node.invalidChildren"));
                            }
                        },
                    },
                ]}
            >
                <Input disabled />
            </Form.Item>

            <Form.Item
                {...createInspectorLabelProps(t("node.name"))}
                name="name"
                rules={[
                    {
                        validator: async (_, value) => {
                            const nextName = String(value ?? "").trim();
                            if (!nextName) {
                                throw new Error(
                                    t("node.notFound", { name: selectedNode.data.name })
                                );
                            }
                            if (nextName === selectedNode.data.name) {
                                return;
                            }
                            if (!findNodeDef(nodeDefMap, nextName)) {
                                throw new Error(
                                    t("node.notFound", {
                                        name: nextName || selectedNode.data.name,
                                    })
                                );
                            }
                        },
                    },
                ]}
            >
                <AutoComplete
                    disabled={readOnly || fieldEditDisabled}
                    options={nodeDefs.map((entry) => ({
                        label: `${entry.name} (${entry.desc})`,
                        value: entry.name,
                    }))}
                    filterOption={filterOptionByLabel}
                    onBlur={onCommitName}
                    onSelect={onQueueCommitName}
                />
            </Form.Item>

            <OverrideBar
                active={
                    canShowOverride &&
                    (selectedNode.data.desc ?? "") !== (subtreeOriginal?.desc ?? "")
                }
                onReset={onResetDesc}
            >
                <Form.Item {...createInspectorLabelProps(t("node.desc"))} name="desc">
                    <TextArea
                        autoSize={{ minRows: 1 }}
                        disabled={readOnly || fieldEditDisabled}
                        onBlur={onCommitDesc}
                    />
                </Form.Item>
            </OverrideBar>

            <OverrideBar
                active={
                    canShowOverride &&
                    Boolean(selectedNode.data.debug) !== Boolean(subtreeOriginal?.debug)
                }
                onReset={onResetDebug}
            >
                <Form.Item
                    {...createInspectorSwitchLabelProps(t("node.debug"))}
                    name="debug"
                    valuePropName="checked"
                >
                    <Switch
                        disabled={readOnly || (fieldEditDisabled && !selectedNode.data.path)}
                        onChange={onQueueCommitDebug}
                    />
                </Form.Item>
            </OverrideBar>

            <OverrideBar
                active={
                    canShowOverride &&
                    Boolean(selectedNode.data.disabled) !== Boolean(subtreeOriginal?.disabled)
                }
                onReset={onResetDisabled}
            >
                <Form.Item
                    {...createInspectorSwitchLabelProps(t("node.disabled"))}
                    name="disabled"
                    valuePropName="checked"
                >
                    <Switch
                        disabled={readOnly || (fieldEditDisabled && !selectedNode.data.path)}
                        onChange={onQueueCommitDisabled}
                    />
                </Form.Item>
            </OverrideBar>

            <Form.Item
                {...createInspectorLabelProps(t("node.subtree"))}
                name="path"
                rules={[
                    {
                        validator: async () => {
                            const error = formatResolutionError();
                            if (error) {
                                throw new Error(error);
                            }
                        },
                    },
                ]}
            >
                <AutoComplete
                    disabled={readOnly || fieldEditDisabled || selectedNode.subtreeNode}
                    options={allFiles.map((path) => ({ label: path, value: path }))}
                    filterOption={filterOptionByLabel}
                    onBlur={onCommitPath}
                    onSelect={onQueueCommitPath}
                />
            </Form.Item>

            {nodeDef?.doc ? (
                <ReactMarkdown className="b3-markdown">{nodeDef.doc}</ReactMarkdown>
            ) : null}
        </>
    );
};

const NodeVariableField: React.FC<{
    form: FormInstance;
    fieldName: SlotFieldName;
    slotDefs: string[];
    slot: string;
    index: number;
    usingVars: Record<string, VarDecl> | null;
    variableOptions: VariableOption[];
    fieldEditDisabled: boolean;
    isOverridden: (index: number, variadic?: boolean) => boolean;
    onReset: (index: number, variadic?: boolean) => void;
    onCommit: () => void;
    onQueueCommit: () => void;
    getRelatedArg?: (index: number) => NodeArg | null;
}> = ({
    form,
    fieldName,
    slotDefs,
    slot,
    index,
    usingVars,
    variableOptions,
    fieldEditDisabled,
    isOverridden,
    onReset,
    onCommit,
    onQueueCommit,
    getRelatedArg,
}) => {
    const { t } = useTranslation();
    const slotDefinition = parseSlotDefinition(slot, slotDefs, index);
    const slotLabel = slotDefinition.label;
    const variadic = slotDefinition.variadic;
    const relatedArg = getRelatedArg?.(index) ?? null;

    const validateSlotValue = async (_: unknown, value: string | undefined) => {
        const error = validateVariableValue(value, usingVars);
        if (error) {
            throw new Error(error);
        }
        if (
            relatedArg &&
            !checkOneof(relatedArg, form.getFieldValue(["args", relatedArg.name]), value)
        ) {
            throw new Error(
                t("validation.oneof", {
                    left: relatedArg.name,
                    right: slotLabel,
                })
            );
        }
    };

    if (variadic) {
        return (
            <OverrideBar active={isOverridden(index, true)} onReset={() => onReset(index, true)}>
                <Form.Item {...createInspectorLabelProps(slotLabel, slotDefinition.required)}>
                    <Form.List name={[fieldName, index]}>
                        {(fields, { add, remove }, { errors }) => (
                            <div className="b3-list-block">
                                {fields.map((field) => (
                                    <Flex key={field.key} gap={4} align="start">
                                        <Form.Item
                                            name={field.name}
                                            style={{ width: "100%", marginBottom: 2 }}
                                            validateTrigger={["onChange", "onBlur"]}
                                            rules={[{ validator: validateSlotValue }]}
                                        >
                                            <AutoComplete
                                                disabled={fieldEditDisabled}
                                                options={variableOptions}
                                                filterOption={filterOptionByLabel}
                                                onBlur={onCommit}
                                            />
                                        </Form.Item>
                                        <MinusCircleOutlined
                                            className="b3-inline-remove"
                                            onClick={() => {
                                                remove(field.name);
                                                onQueueCommit();
                                            }}
                                        />
                                    </Flex>
                                ))}
                                <Form.Item style={{ marginBottom: 0, marginTop: 4 }}>
                                    <Button
                                        type="dashed"
                                        block
                                        icon={<PlusOutlined />}
                                        onClick={() => add("")}
                                    >
                                        {t("add")}
                                    </Button>
                                    <Form.ErrorList errors={errors} />
                                </Form.Item>
                            </div>
                        )}
                    </Form.List>
                </Form.Item>
            </OverrideBar>
        );
    }

    return (
        <OverrideBar active={isOverridden(index)} onReset={() => onReset(index)}>
            <Form.Item
                {...createInspectorLabelProps(slotLabel, slotDefinition.required)}
                name={[fieldName, index]}
                rules={[
                    {
                        required: slotDefinition.required,
                        message: t("fieldRequired", {
                            field: slotLabel,
                        }),
                    },
                    {
                        validator: validateSlotValue,
                    },
                ]}
            >
                <AutoComplete
                    disabled={fieldEditDisabled}
                    options={variableOptions}
                    filterOption={filterOptionByLabel}
                    onBlur={onCommit}
                />
            </Form.Item>
        </OverrideBar>
    );
};

const NodeVariableSection: React.FC<{
    form: FormInstance;
    title: string;
    fieldName: SlotFieldName;
    slotDefs?: string[];
    usingVars: Record<string, VarDecl> | null;
    variableOptions: VariableOption[];
    fieldEditDisabled: boolean;
    isOverridden: (index: number, variadic?: boolean) => boolean;
    onReset: (index: number, variadic?: boolean) => void;
    onCommit: (index: number, variadic?: boolean) => void;
    onQueueCommit: (index: number, variadic?: boolean) => void;
    getRelatedArg?: (index: number) => NodeArg | null;
}> = ({
    form,
    title,
    fieldName,
    slotDefs,
    usingVars,
    variableOptions,
    fieldEditDisabled,
    isOverridden,
    onReset,
    onCommit,
    onQueueCommit,
    getRelatedArg,
}) => {
    if (!slotDefs?.length) {
        return null;
    }

    return (
        <>
            <SectionDivider>{title}</SectionDivider>
            {slotDefs.map((slot, index) => (
                <NodeVariableField
                    key={`${fieldName}-${index}`}
                    form={form}
                    fieldName={fieldName}
                    slotDefs={slotDefs}
                    slot={slot}
                    index={index}
                    usingVars={usingVars}
                    variableOptions={variableOptions}
                    fieldEditDisabled={fieldEditDisabled}
                    isOverridden={isOverridden}
                    onReset={onReset}
                    onCommit={() =>
                        onCommit(index, parseSlotDefinition(slot, slotDefs, index).variadic)
                    }
                    onQueueCommit={() =>
                        onQueueCommit(index, parseSlotDefinition(slot, slotDefs, index).variadic)
                    }
                    getRelatedArg={getRelatedArg}
                />
            ))}
        </>
    );
};

const NodeStructuredArgsSection: React.FC<{
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

const NodeRawJsonSection: React.FC<{ visible: boolean }> = ({ visible }) => {
    const { t } = useTranslation();

    if (!visible) {
        return null;
    }

    return (
        <>
            <SectionDivider>{t("node.jsonData")}</SectionDivider>
            <Form.Item {...createInspectorLabelProps(t("node.jsonData"))} name="rawNodeJson">
                <TextArea autoSize={{ minRows: 1 }} disabled />
            </Form.Item>
        </>
    );
};

export const NodeInspectorForm: React.FC = () => {
    const runtime = useRuntime();
    const { t } = useTranslation();
    const { readOnly } = useInspectorMode();
    const [form] = Form.useForm();
    const {
        selectedNode,
        pendingSelectedNodeSnapshot,
        nodeDefs,
        usingVars,
        usingGroups,
        allFiles,
        checkExpr,
        nodeCheckDiagnostics,
        nodeDefMap,
        variableOptions,
        nodeDef,
        fieldEditDisabled,
        structuredArgs,
        hasStructuredArgs,
        shouldShowRawNodeJson,
        subtreeOriginal,
        canShowOverride,
    } = useNodeInspectorViewState(form);
    const effectiveReadOnly = readOnly || pendingSelectedNodeSnapshot;

    useEffect(() => {
        if (!selectedNode) {
            return;
        }

        const currentNodeDef = findNodeDef(nodeDefMap, selectedNode.data.name);
        form.setFieldsValue(
            createNodeInspectorFormValues(currentNodeDef, selectedNode, t("node.unknownType"))
        );
    }, [form, nodeDefMap, selectedNode, t]);

    useEffect(() => {
        if (!selectedNode || effectiveReadOnly) {
            return;
        }

        const timer = window.setTimeout(() => {
            void form.validateFields({ recursive: true }).catch(() => undefined);
        }, 100);

        return () => window.clearTimeout(timer);
    }, [
        checkExpr,
        form,
        nodeCheckDiagnostics,
        nodeDef,
        effectiveReadOnly,
        selectedNode,
        usingGroups,
        usingVars,
    ]);

    if (!selectedNode) {
        return null;
    }

    const {
        relatedArgForInput,
        commitName,
        commitDesc,
        commitDebug,
        commitDisabled,
        commitPath,
        isInputOverridden,
        isOutputOverridden,
        isArgOverridden,
        resetInputField,
        resetOutputField,
        resetArgField,
        resetDesc,
        resetDebug,
        resetDisabled,
        commitInputField,
        commitOutputField,
        commitArgField,
    } = useNodeInspectorCommitters({
        form,
        runtime,
        selectedNode,
        nodeDef,
        nodeDefMap,
        subtreeOriginal,
        fieldEditDisabled,
        effectiveReadOnly,
        canShowOverride,
    });

    const canOpenSubtree = canOpenSubtreeTarget(selectedNode.data.path, selectedNode.ref);

    return (
        <div className="b3-inspector-content">
            <Form
                key={selectedNode.ref.instanceKey}
                form={form}
                className="b3-inspector-form"
                labelCol={{ flex: "110px", xs: { flex: "110px" } }}
                wrapperCol={{ flex: "1 1 0%", xs: { flex: "1 1 0%" } }}
                labelAlign="right"
                requiredMark={false}
            >
                <NodeMetaFields
                    selectedNode={selectedNode}
                    nodeDefs={nodeDefs}
                    nodeDef={nodeDef}
                    nodeDefMap={nodeDefMap}
                    usingGroups={usingGroups}
                    allFiles={allFiles}
                    fieldEditDisabled={fieldEditDisabled}
                    readOnly={effectiveReadOnly}
                    canShowOverride={canShowOverride}
                    subtreeOriginal={subtreeOriginal}
                    onCommitName={commitName}
                    onQueueCommitName={commitName}
                    onCommitDesc={commitDesc}
                    onQueueCommitDebug={commitDebug}
                    onQueueCommitDisabled={commitDisabled}
                    onCommitPath={commitPath}
                    onQueueCommitPath={commitPath}
                    onResetDesc={resetDesc}
                    onResetDebug={resetDebug}
                    onResetDisabled={resetDisabled}
                />

                <NodeVariableSection
                    form={form}
                    title={t("node.inputVariable")}
                    fieldName="inputSlots"
                    slotDefs={nodeDef?.input}
                    usingVars={usingVars}
                    variableOptions={variableOptions}
                    fieldEditDisabled={effectiveReadOnly || fieldEditDisabled}
                    isOverridden={isInputOverridden}
                    onReset={resetInputField}
                    onCommit={commitInputField}
                    onQueueCommit={commitInputField}
                    getRelatedArg={relatedArgForInput}
                />

                {hasStructuredArgs && nodeDef ? (
                    <NodeStructuredArgsSection
                        form={form}
                        nodeDef={nodeDef}
                        args={structuredArgs}
                        committedArgs={selectedNode.data.args}
                        usingVars={usingVars}
                        checkExpr={checkExpr}
                        nodeCheckDiagnostics={nodeCheckDiagnostics}
                        fieldEditDisabled={effectiveReadOnly || fieldEditDisabled}
                        isOverridden={isArgOverridden}
                        onReset={resetArgField}
                        onCommit={commitArgField}
                        onQueueCommit={commitArgField}
                    />
                ) : (
                    <NodeRawJsonSection visible={shouldShowRawNodeJson} />
                )}

                <NodeVariableSection
                    form={form}
                    title={t("node.outputVariable")}
                    fieldName="outputSlots"
                    slotDefs={nodeDef?.output}
                    usingVars={usingVars}
                    variableOptions={variableOptions}
                    fieldEditDisabled={effectiveReadOnly || fieldEditDisabled}
                    isOverridden={isOutputOverridden}
                    onReset={resetOutputField}
                    onCommit={commitOutputField}
                    onQueueCommit={commitOutputField}
                />

                {canOpenSubtree ? (
                    <Button
                        type="primary"
                        htmlType="button"
                        block
                        icon={<FormOutlined />}
                        className="b3-node-subtree-button"
                        onClick={() =>
                            void runtime.controller.openSelectedSubtree(selectedNode.ref)
                        }
                    >
                        {t("editSubtree")}
                    </Button>
                ) : null}
            </Form>
        </div>
    );
};
