import { FormOutlined } from "@ant-design/icons";
import { Button, Form, Input, InputNumber, Select } from "antd";
import React, { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useRuntime, useWebviewKind } from "../../app/runtime";
import { ABORT_MODES, type AbortMode, type ConditionCustom } from "../../shared/b3type";
import {
    CONDITION_ENTER_PRIORITY_KEY,
    CONDITION_MAINTAIN_PRIORITY_KEY,
    readConditionPriorities,
    refreshConditionPriorities,
    withConditionPriorities,
    type ConditionPriorities,
} from "../../shared/condition-branch";
import type { PersistedConditionData } from "../../shared/contracts";
import { stringifySearchValueAsJson5 } from "../../shared/json";
import { clonePersistedConditions } from "../../shared/tree";
import { CustomDataSection } from "./custom-data-section";
import { queueInspectorTask, trackPendingInspectorEdit } from "./inspector-commit-queue";
import {
    buildCommittedNodeData,
    buildTreeCustomRecord,
    type TreeCustomRowValue,
} from "./inspector-form-values";
import { createInspectorLabelProps } from "./inspector-shared";
import { useNodeInspectorState } from "./inspector-state";

const toCustomRows = (
    custom: ConditionCustom | undefined,
    priorities: ConditionPriorities
): TreeCustomRowValue[] => [
    { key: CONDITION_ENTER_PRIORITY_KEY, value: String(priorities.enterPriority) },
    { key: CONDITION_MAINTAIN_PRIORITY_KEY, value: String(priorities.maintainPriority) },
    ...Object.entries(custom ?? {})
        .filter(
            ([key]) =>
                key !== CONDITION_ENTER_PRIORITY_KEY && key !== CONDITION_MAINTAIN_PRIORITY_KEY
        )
        .map(([key, value]) => ({ key, value: stringifySearchValueAsJson5(value) })),
];

/** Inspector for the first entry of the selected node's `conditions`. */
export const ConditionInspectorForm: React.FC = () => {
    const { t } = useTranslation();
    const runtime = useRuntime();
    const webviewKind = useWebviewKind();
    const [form] = Form.useForm();
    const { selectedNode } = useNodeInspectorState();
    const conditions = selectedNode?.data.conditions;
    const condition = conditions?.[0];
    const readOnly = selectedNode?.disabled ?? false;

    // Stored priorities follow the host id only on save; show and commit the current values.
    const priorities = useMemo(() => {
        if (!condition) {
            return { enterPriority: 0, maintainPriority: 0 };
        }
        const stored = readConditionPriorities(condition);
        return refreshConditionPriorities(
            stored.enterPriority,
            stored.maintainPriority,
            selectedNode?.ref.displayId
        );
    }, [condition, selectedNode?.ref.displayId]);
    const maintainMax = Math.max(0, priorities.enterPriority);

    useEffect(() => {
        if (!condition) {
            return;
        }
        form.setFieldsValue({
            entryName: condition.root.name,
            abort: condition.abort,
            customRows: toCustomRows(condition.custom, priorities),
        });
    }, [condition, priorities, form]);

    const commitCondition = (next: Pick<PersistedConditionData, "abort" | "custom">) => {
        if (!selectedNode || !conditions?.length || !condition || readOnly) {
            return;
        }
        const nextConditions = clonePersistedConditions(conditions) ?? [];
        nextConditions[0] = { ...nextConditions[0], abort: next.abort, custom: next.custom };
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
        commitCondition({
            abort,
            custom: withConditionPriorities(condition.custom, priorities),
        });
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
        const custom = buildTreeCustomRecord(rows);
        const maintain = custom[CONDITION_MAINTAIN_PRIORITY_KEY];
        const maintainPriority =
            typeof maintain === "number" && Number.isInteger(maintain)
                ? Math.min(maintainMax, Math.max(0, maintain))
                : priorities.maintainPriority;
        commitCondition({
            abort: condition.abort,
            custom: withConditionPriorities(custom, {
                enterPriority: priorities.enterPriority,
                maintainPriority,
            }),
        });
    };

    if (!selectedNode || !condition) {
        return null;
    }

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
                <Form.Item {...createInspectorLabelProps(t("condition.abort"))} name="abort">
                    <Select
                        style={{ width: "100%" }}
                        disabled={readOnly}
                        options={ABORT_MODES.map((value) => ({ value, label: value }))}
                        onChange={commitAbort}
                    />
                </Form.Item>
                <CustomDataSection
                    form={form}
                    name="customRows"
                    title={t("condition.custom")}
                    readOnly={readOnly}
                    reservedKeys={[
                        {
                            key: CONDITION_ENTER_PRIORITY_KEY,
                            renderValue: ({ value }) => <Input disabled value={value} />,
                        },
                        {
                            key: CONDITION_MAINTAIN_PRIORITY_KEY,
                            renderValue: ({ value, disabled, commit }) => (
                                <InputNumber
                                    key={value}
                                    style={{ width: "100%" }}
                                    disabled={disabled}
                                    precision={0}
                                    step={1}
                                    min={0}
                                    max={maintainMax}
                                    defaultValue={Number(value)}
                                    onBlur={(event) => commit(event.target.value)}
                                />
                            ),
                        },
                    ]}
                    queueCommit={() => queueInspectorTask(() => void commitCustomRows())}
                />
                <Button
                    type="primary"
                    htmlType="button"
                    block
                    icon={<FormOutlined />}
                    className="b3-node-subtree-button"
                    onClick={() => {
                        if (webviewKind === "inspector-sidebar") {
                            runtime.hostAdapter.requestOpenConditionEditor(selectedNode.ref);
                            return;
                        }
                        void runtime.controller.openConditionEditor(selectedNode.ref);
                    }}
                >
                    {t("condition.openEditor")}
                </Button>
            </Form>
        </div>
    );
};
