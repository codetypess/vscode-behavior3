import { FormOutlined } from "@ant-design/icons";
import { AutoComplete, Button, Form, Input, Select, Space, Switch } from "antd";
import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import { canOpenSubtreeTarget } from "../../domain/subtree-navigation";
import { findNodeDef, parseSlotDefinition } from "../../shared/node-utils";
import { isExprType, type NodeDef } from "../../shared/b3type";
import { useRuntime } from "../../app/runtime";
import {
    OverrideBar,
    SectionDivider,
    createInspectorLabelProps,
    createInspectorSwitchLabelProps,
    filterOptionByLabel,
} from "./inspector-shared";
import { useNodeInspectorViewState } from "./inspector-state";
import {
    buildCommittedNodeData,
    createNodeInspectorFormValues,
    getEffectiveNodeArgs,
    getNodeInspectorSyncMode,
    shouldLockPendingInspectorForm,
} from "./inspector-form-values";
import { trackPendingInspectorEdit } from "./inspector-commit-queue";
import {
    buildArgsWithoutHiddenVisibility,
    buildSlotArrayWithoutHiddenVisibility,
    collectHiddenStructuredArgNames,
    collectHiddenStructuredSlotIndices,
} from "./inspector-arg-visibility";
import { useInspectorJsonView } from "./inspector-json-view";
import { useInspectorMode } from "./inspector-mode";
import { useNodeInspectorCommitters } from "./node-inspector-committers";
import { NodeStructuredArgsSection } from "./node-inspector-args-section";
import { NodeVariableSection } from "./node-inspector-variable-section";

const { TextArea } = Input;

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
    showNodeDoc: boolean;
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
    showNodeDoc,
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
            <Form.Item {...createInspectorLabelProps(t("node.id"))}>
                <Space.Compact block className="b3-node-identity-field">
                    <Input
                        disabled
                        value={selectedNode.ref.displayId}
                        title={selectedNode.ref.displayId}
                        className="b3-node-identity-id"
                    />
                    <Input
                        disabled
                        value={selectedNode.data.uuid}
                        title={selectedNode.data.uuid}
                        className="b3-node-identity-uuid"
                        style={{ width: "100%" }}
                    />
                </Space.Compact>
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

            {showNodeDoc && nodeDef?.doc ? (
                <ReactMarkdown className="b3-markdown">{nodeDef.doc}</ReactMarkdown>
            ) : null}
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
            <Form.Item name="rawNodeJson" className="b3-node-json-form-item">
                <TextArea
                    autoSize={{ minRows: 12, maxRows: 24 }}
                    className="b3-node-json-view"
                    readOnly
                />
            </Form.Item>
        </>
    );
};

export const NodeInspectorForm: React.FC = () => {
    const runtime = useRuntime();
    const { t } = useTranslation();
    const { readOnly } = useInspectorMode();
    const { nodeJsonVisible } = useInspectorJsonView();
    const [form] = Form.useForm();
    const {
        selectedNode,
        pendingSelectedNodeSnapshot,
        nodeDefs,
        usingVars,
        usingGroups,
        allFiles,
        checkExpr,
        nodeFieldDiagnostics,
        selectedNodeFieldVisibility,
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
    const previousSelectedNodeRef = useRef<NonNullable<typeof selectedNode> | null>(null);
    const effectiveReadOnly = shouldLockPendingInspectorForm({
        readOnly,
        pendingSelectedNodeSnapshot,
        previousSelectedNode: previousSelectedNodeRef.current,
        nextSelectedNode: selectedNode,
    });
    const selectedNodeSyncMode = selectedNode
        ? getNodeInspectorSyncMode(previousSelectedNodeRef.current, selectedNode)
        : "replace";

    const clearStructuredNodeFields = () => {
        form.setFieldValue("args", {});
        form.setFieldValue("inputSlots", []);
        form.setFieldValue("outputSlots", []);
    };

    useEffect(() => {
        if (!selectedNode) {
            previousSelectedNodeRef.current = null;
            return;
        }

        const currentNodeDef = findNodeDef(nodeDefMap, selectedNode.data.name);
        const nextValues = createNodeInspectorFormValues(
            currentNodeDef,
            selectedNode,
            t("node.unknownType")
        );
        if (selectedNodeSyncMode === "replace") {
            // Antd merges nested objects on setFieldsValue, so clear prior node fields first.
            form.resetFields();
            clearStructuredNodeFields();
        } else if (selectedNodeSyncMode === "patch-and-clear-scoped-fields") {
            clearStructuredNodeFields();
        }

        form.setFieldsValue(nextValues);
        previousSelectedNodeRef.current = selectedNode;
    }, [form, nodeDefMap, selectedNode, t]);

    useEffect(() => {
        if (!selectedNode) {
            return;
        }

        const currentName = String(form.getFieldValue("name") ?? selectedNode.data.name).trim();
        if (!currentName || currentName === selectedNode.data.name) {
            return;
        }

        const previewValues = createNodeInspectorFormValues(
            nodeDef,
            selectedNode,
            t("node.unknownType")
        );
        form.setFieldValue("args", {});
        form.setFieldValue("inputSlots", []);
        form.setFieldValue("outputSlots", []);
        form.resetFields(["type", "children", "group"]);
        form.setFieldsValue({
            type: previewValues.type,
            children: previewValues.children,
            group: previewValues.group,
            args: previewValues.args,
            inputSlots: previewValues.inputSlots,
            outputSlots: previewValues.outputSlots,
        });
    }, [form, nodeDef, selectedNode, t]);

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
        nodeFieldDiagnostics,
        nodeDef,
        effectiveReadOnly,
        selectedNode,
        usingGroups,
        usingVars,
    ]);

    useEffect(() => {
        if (!selectedNode || effectiveReadOnly) {
            return;
        }

        const currentNodeDef = findNodeDef(nodeDefMap, selectedNode.data.name);
        const hiddenArgNames = collectHiddenStructuredArgNames(
            currentNodeDef?.args ?? [],
            selectedNodeFieldVisibility.args
        );
        const hiddenInputIndices = collectHiddenStructuredSlotIndices(
            currentNodeDef?.input ?? [],
            selectedNodeFieldVisibility.input
        );
        const hiddenOutputIndices = collectHiddenStructuredSlotIndices(
            currentNodeDef?.output ?? [],
            selectedNodeFieldVisibility.output
        );
        if (
            hiddenArgNames.length === 0 &&
            hiddenInputIndices.length === 0 &&
            hiddenOutputIndices.length === 0
        ) {
            return;
        }

        form.setFields([
            ...hiddenArgNames.map((argName) => ({
                name: ["args", argName],
                value: undefined,
                touched: false,
                errors: [],
                warnings: [],
            })),
            ...hiddenInputIndices.map((index) => ({
                name: ["inputSlots", index],
                value: parseSlotDefinition(
                    currentNodeDef?.input?.[index] ?? "",
                    currentNodeDef?.input,
                    index
                ).variadic
                    ? []
                    : "",
                touched: false,
                errors: [],
                warnings: [],
            })),
            ...hiddenOutputIndices.map((index) => ({
                name: ["outputSlots", index],
                value: parseSlotDefinition(
                    currentNodeDef?.output?.[index] ?? "",
                    currentNodeDef?.output,
                    index
                ).variadic
                    ? []
                    : "",
                touched: false,
                errors: [],
                warnings: [],
            })),
        ]);

        const nextArgs = buildArgsWithoutHiddenVisibility(
            selectedNode.data.args,
            currentNodeDef?.args ?? [],
            selectedNodeFieldVisibility.args
        );
        const nextInput = buildSlotArrayWithoutHiddenVisibility(
            selectedNode.data.input,
            currentNodeDef?.input ?? [],
            selectedNodeFieldVisibility.input
        );
        const nextOutput = buildSlotArrayWithoutHiddenVisibility(
            selectedNode.data.output,
            currentNodeDef?.output ?? [],
            selectedNodeFieldVisibility.output
        );
        if (
            nextArgs === selectedNode.data.args &&
            nextInput === selectedNode.data.input &&
            nextOutput === selectedNode.data.output
        ) {
            return;
        }

        trackPendingInspectorEdit(
            runtime.controller.updateNode({
                target: selectedNode.ref,
                data: {
                    ...buildCommittedNodeData(selectedNode),
                    args: nextArgs,
                    input: nextInput,
                    output: nextOutput,
                },
            })
        );
    }, [
        effectiveReadOnly,
        form,
        nodeDefMap,
        runtime.controller,
        selectedNode,
        selectedNodeFieldVisibility,
    ]);

    if (!selectedNode) {
        return null;
    }

    const showRawNodeJson = shouldShowRawNodeJson || nodeJsonVisible;

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
        resetArgToDefault,
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
                    showNodeDoc={!showRawNodeJson}
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
                    slotDefs={showRawNodeJson ? undefined : nodeDef?.input}
                    usingVars={usingVars}
                    variableOptions={variableOptions}
                    fieldEditDisabled={effectiveReadOnly || fieldEditDisabled}
                    visibility={selectedNodeFieldVisibility.input}
                    currentSlots={selectedNode.data.input}
                    nodeFieldDiagnostics={nodeFieldDiagnostics}
                    isOverridden={isInputOverridden}
                    onReset={resetInputField}
                    onCommit={commitInputField}
                    onQueueCommit={commitInputField}
                    getRelatedArg={relatedArgForInput}
                />

                {!showRawNodeJson && hasStructuredArgs && nodeDef ? (
                    <NodeStructuredArgsSection
                        form={form}
                        nodeDef={nodeDef}
                        args={structuredArgs}
                        effectiveArgs={getEffectiveNodeArgs(selectedNode)}
                        usingVars={usingVars}
                        checkExpr={checkExpr}
                        nodeFieldDiagnostics={nodeFieldDiagnostics}
                        fieldEditDisabled={effectiveReadOnly || fieldEditDisabled}
                        isOverridden={isArgOverridden}
                        onReset={resetArgField}
                        onResetToDefault={resetArgToDefault}
                        onCommit={commitArgField}
                        onQueueCommit={commitArgField}
                    />
                ) : (
                    <NodeRawJsonSection visible={showRawNodeJson} />
                )}

                <NodeVariableSection
                    form={form}
                    title={t("node.outputVariable")}
                    fieldName="outputSlots"
                    slotDefs={showRawNodeJson ? undefined : nodeDef?.output}
                    usingVars={usingVars}
                    variableOptions={variableOptions}
                    fieldEditDisabled={effectiveReadOnly || fieldEditDisabled}
                    visibility={selectedNodeFieldVisibility.output}
                    currentSlots={selectedNode.data.output}
                    nodeFieldDiagnostics={nodeFieldDiagnostics}
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
