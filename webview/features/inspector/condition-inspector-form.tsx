import { FormOutlined } from "@ant-design/icons";
import { Button, Form, Input, Select } from "antd";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useRuntime, useSelectionStore, useWorkspaceStore } from "../../app/runtime";
import { ABORT_MODES, type AbortMode } from "../../shared/b3type";
import { getAbortModeViolation } from "../../shared/condition-branch";
import type { PersistedConditionData } from "../../shared/contracts";
import { clonePersistedConditions } from "../../shared/tree";
import { CustomDataSection } from "./custom-data-section";
import { queueInspectorTask, trackPendingInspectorEdit } from "./inspector-commit-queue";
import {
    buildCommittedNodeData,
    buildTreeCustomRecord,
    createCustomRows,
    type TreeCustomRowValue,
} from "./inspector-form-values";
import { createInspectorLabelProps } from "./inspector-shared";
import { useNodeInspectorState } from "./inspector-state";

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
    const hostNodeId = selectedNode?.ref.displayId;

    useEffect(() => {
        if (!condition) {
            return;
        }
        form.setFieldsValue({
            entryName: condition.root.name,
            abort: condition.abort,
            customRows: createCustomRows(condition.custom, customFields, hostNodeId),
        });
    }, [condition, customFields, form, hostNodeId]);


    const commitCondition = (next: Pick<PersistedConditionData, "abort" | "custom">) => {
        if (!selectedNode || !conditions?.length || !condition || readOnly) {
            return;
        }
        const nextConditions = clonePersistedConditions(conditions) ?? [];
        nextConditions[index] = {
            ...nextConditions[index],
            abort: next.abort,
            custom: next.custom,
        };
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
        commitCondition({ abort, custom: condition.custom });
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
        commitCondition({
            abort: condition.abort,
            custom: Object.keys(custom).length > 0 ? custom : undefined,
        });
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
