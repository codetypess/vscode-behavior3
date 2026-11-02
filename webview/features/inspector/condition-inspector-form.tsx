import { FormOutlined } from "@ant-design/icons";
import { Button, Form, Input, Select } from "antd";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import { useRuntime, useSelectionStore, useWorkspaceStore } from "../../app/runtime";
import { ABORT_MODES, type AbortMode } from "../../shared/b3type";
import { getAbortModeViolation } from "../../shared/condition-branch";
import type { PersistedConditionData } from "../../shared/contracts";
import { createNodeDefMap, findNodeDef } from "../../shared/node-utils";
import { clonePersistedConditions } from "../../shared/tree";
import { CustomDataSection } from "./custom-data-section";
import { queueInspectorTask, trackPendingInspectorEdit } from "./inspector-commit-queue";
import {
    buildCommittedNodeData,
    buildTreeCustomRecord,
    createCustomRows,
    type TreeCustomRowValue,
} from "./inspector-form-values";
import { createInspectorLabelProps, SectionDivider } from "./inspector-shared";
import { useNodeInspectorState } from "./inspector-state";

const { TextArea } = Input;

/** Inspector for the selected item of the selected node's `conditions`. */
export const ConditionInspectorForm: React.FC = () => {
    const { t } = useTranslation();
    const runtime = useRuntime();
    const [form] = Form.useForm();
    const { selectedNode } = useNodeInspectorState();
    const conditions = selectedNode?.data.conditions;
    const count = conditions?.length ?? 0;
    const selectedIndex = useSelectionStore((state) => state.selectedConditionIndex);
    // Undo or an outside edit can drop items; fall back to the last one.
    const index = Math.max(0, Math.min(selectedIndex, count - 1));
    const condition = conditions?.[index];
    const readOnly = selectedNode?.disabled ?? false;
    const customFields = useWorkspaceStore((state) => state.settings.customFields.condition);
    const nodeDefs = useWorkspaceStore((state) => state.nodeDefs);
    const hostNodeId = selectedNode?.ref.displayId;
    // Like the node inspector: show the definition's description until the node has its own.
    const rootDefDesc = condition
        ? findNodeDef(createNodeDefMap(nodeDefs), condition.root.name)?.desc?.trim() || undefined
        : undefined;

    useEffect(() => {
        if (!condition) {
            return;
        }
        form.setFieldsValue({
            entryName: condition.root.name,
            abort: condition.abort,
            rootDesc: condition.root.desc ?? rootDefDesc ?? "",
            conditionDesc: condition.desc ?? "",
            customRows: createCustomRows(condition.custom, customFields, hostNodeId),
        });
    }, [condition, customFields, form, hostNodeId, rootDefDesc]);

    const commitCondition = (patch: Partial<PersistedConditionData>) => {
        if (!selectedNode || !conditions?.length || !condition || readOnly) {
            return;
        }
        const nextConditions = clonePersistedConditions(conditions) ?? [];
        nextConditions[index] = { ...nextConditions[index], ...patch };
        trackPendingInspectorEdit(
            runtime.controller.updateNode({
                target: selectedNode.ref,
                data: {
                    ...buildCommittedNodeData(selectedNode),
                    conditions: nextConditions,
                },
            })
        );
    };

    const commitAbort = (abort: AbortMode) => {
        if (!condition || abort === condition.abort) {
            return;
        }
        commitCondition({ abort });
    };

    /** The condition tree's root node description; the definition's text is not stored. */
    const commitRootDesc = () => {
        if (!condition) {
            return;
        }
        const value = String(form.getFieldValue("rootDesc") ?? "").trim() || undefined;
        const desc = value === rootDefDesc ? undefined : value;
        if (desc === condition.root.desc) {
            return;
        }
        commitCondition({ root: { ...condition.root, desc } });
    };

    /** The condition item's own description ("tree properties": the condition tree's desc). */
    const commitConditionDesc = () => {
        if (!condition) {
            return;
        }
        const desc = String(form.getFieldValue("conditionDesc") ?? "").trim() || undefined;
        if (desc !== condition.desc) {
            commitCondition({ desc });
        }
    };

    const commitCustomRows = async () => {
        if (!condition) {
            return;
        }
        try {
            await form.validateFields(["customRows"], { recursive: true });
        } catch {
            return;
        }
        const rows = (form.getFieldValue("customRows") as TreeCustomRowValue[] | undefined) ?? [];
        const custom = buildTreeCustomRecord(rows, customFields);
        commitCondition({ custom: Object.keys(custom).length > 0 ? custom : undefined });
    };

    if (!selectedNode || !condition) {
        return null;
    }

    // `lower`/`both` need a preemptive parent; an existing value that cannot work is an error.
    // A tree root cannot carry conditions at all. `undefined` means the parent is not known yet.
    const conditionParent = selectedNode.conditionParent ?? null;
    const onRoot = selectedNode.conditionParent === null;
    const describeViolation = (abort: AbortMode) => {
        const violation = getAbortModeViolation(abort, conditionParent);
        return violation
            ? t("condition.abortNeedsPreemptive", { abort, parent: violation.parentName })
            : undefined;
    };
    const currentError = onRoot ? t("condition.onRoot") : describeViolation(condition.abort);

    return (
        <div className="b3-inspector-content">
            <Form
                form={form}
                className="b3-inspector-form"
                labelCol={{ flex: "110px" }}
                wrapperCol={{ flex: "1 1 0%" }}
                labelAlign="right"
                requiredMark={false}
            >
                <Form.Item {...createInspectorLabelProps(t("condition.entry"))} name="entryName">
                    <Input disabled />
                </Form.Item>
                <Form.Item
                    {...createInspectorLabelProps(t("condition.abort"))}
                    name="abort"
                    validateStatus={currentError ? "error" : undefined}
                    help={currentError}
                >
                    <Select
                        style={{ width: "100%" }}
                        disabled={readOnly}
                        options={ABORT_MODES.map((value) => {
                            const violation = getAbortModeViolation(value, conditionParent);
                            return {
                                value,
                                label: value,
                                disabled: Boolean(violation),
                                title: violation ? describeViolation(value) : undefined,
                            };
                        })}
                        onChange={commitAbort}
                    />
                </Form.Item>
                <Form.Item {...createInspectorLabelProps(t("node.desc"))} name="rootDesc">
                    <TextArea
                        autoSize={{ minRows: 1 }}
                        disabled={readOnly}
                        onBlur={commitRootDesc}
                    />
                </Form.Item>
                <ReactMarkdown className="b3-markdown">
                    {[
                        t(`condition.abortHelp.${condition.abort}`),
                        t("condition.resultHelp.value"),
                        t("condition.resultHelp.skip"),
                        t("condition.resultHelp.running"),
                    ]
                        .map((line) => `+ ${line}`)
                        .join("\n")}
                </ReactMarkdown>
                <SectionDivider>{t("condition.treeProps")}</SectionDivider>
                <Form.Item {...createInspectorLabelProps(t("tree.desc"))} name="conditionDesc">
                    <TextArea
                        autoSize={{ minRows: 1 }}
                        disabled={readOnly}
                        onBlur={commitConditionDesc}
                    />
                </Form.Item>
                <CustomDataSection
                    form={form}
                    name="customRows"
                    title={t("condition.custom")}
                    readOnly={readOnly}
                    fields={customFields}
                    queueCommit={() => queueInspectorTask(() => void commitCustomRows())}
                />
                <Button
                    type="primary"
                    htmlType="button"
                    block
                    icon={<FormOutlined />}
                    className="b3-node-subtree-button"
                    onClick={() =>
                        void runtime.controller.openConditionFile(selectedNode.ref, index)
                    }
                >
                    {t("condition.openEditor")}
                </Button>
            </Form>
        </div>
    );
};
