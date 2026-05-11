import { FormOutlined } from "@ant-design/icons";
import { AutoComplete, Button, Form, Input, Select, Switch } from "antd";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import { canOpenSubtreeTarget } from "../../domain/subtree-navigation";
import { findNodeDef } from "../../shared/node-utils";
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
import { createNodeInspectorFormValues } from "./inspector-form-values";
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
