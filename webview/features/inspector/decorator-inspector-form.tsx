import { FormOutlined } from "@ant-design/icons";
import { Button, Form, Input, InputNumber, Select } from "antd";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useRuntime, useWebviewKind } from "../../app/runtime";
import { ABORT_TYPES, type AbortType } from "../../shared/b3type";
import { refreshDecoratorPriorities } from "../../shared/decorator-branch";
import { cloneDecoratorAttachment } from "../../shared/tree";
import { trackPendingInspectorEdit } from "./inspector-commit-queue";
import { buildCommittedNodeData } from "./inspector-form-values";
import { createInspectorLabelProps } from "./inspector-shared";
import { useNodeInspectorState } from "./inspector-state";

export const DecoratorInspectorForm: React.FC = () => {
    const { t } = useTranslation();
    const runtime = useRuntime();
    const webviewKind = useWebviewKind();
    const [form] = Form.useForm();
    const { selectedNode } = useNodeInspectorState();
    const decorator = selectedNode?.data.decorator;
    const readOnly = selectedNode?.disabled ?? false;
    const refreshedPriorities = decorator
        ? refreshDecoratorPriorities(
              decorator.enterPriority,
              decorator.maintainPriority,
              selectedNode?.ref.displayId
          )
        : undefined;
    const enterPriority = refreshedPriorities?.enterPriority ?? 0;
    const displayedMaintainPriority = refreshedPriorities?.maintainPriority ?? 0;
    const maintainMax = Math.max(0, enterPriority);

    useEffect(() => {
        if (!decorator) {
            return;
        }
        form.setFieldsValue({
            entryName: decorator.root.name,
            enterPriority,
            maintainPriority: displayedMaintainPriority,
            abortType: decorator.abortType,
        });
    }, [decorator, displayedMaintainPriority, enterPriority, form]);

    const commitAbortType = (next: AbortType) => {
        if (!selectedNode || !decorator || readOnly || next === decorator.abortType) {
            return;
        }
        trackPendingInspectorEdit(
            runtime.controller.updateNode({
                target: selectedNode.ref,
                data: {
                    ...buildCommittedNodeData(selectedNode),
                    decorator: {
                        ...cloneDecoratorAttachment(decorator),
                        enterPriority,
                        maintainPriority: displayedMaintainPriority,
                        abortType: next,
                    },
                },
            })
        );
    };

    const commitMaintainPriority = () => {
        if (!selectedNode || !decorator || readOnly) {
            return;
        }
        const raw = form.getFieldValue("maintainPriority");
        const next = typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : maintainMax;
        if (!Number.isInteger(next) || next < 0 || next > maintainMax) {
            form.setFieldValue("maintainPriority", displayedMaintainPriority);
            return;
        }
        if (
            next === decorator.maintainPriority &&
            enterPriority === decorator.enterPriority
        ) {
            return;
        }
        trackPendingInspectorEdit(
            runtime.controller.updateNode({
                target: selectedNode.ref,
                data: {
                    ...buildCommittedNodeData(selectedNode),
                    decorator: {
                        ...cloneDecoratorAttachment(decorator),
                        enterPriority,
                        maintainPriority: next,
                    },
                },
            })
        );
    };

    if (!selectedNode || !decorator) {
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
                <Form.Item {...createInspectorLabelProps(t("decorator.entry"))} name="entryName">
                    <Input disabled />
                </Form.Item>
                <Form.Item
                    {...createInspectorLabelProps(t("node.enterPriority"))}
                    name="enterPriority"
                >
                    <InputNumber style={{ width: "100%" }} disabled precision={0} />
                </Form.Item>
                <Form.Item
                    {...createInspectorLabelProps(t("node.maintainPriority"))}
                    name="maintainPriority"
                    rules={[
                        {
                            validator: async (_, value: unknown) => {
                                if (typeof value !== "number" || !Number.isInteger(value)) {
                                    throw new Error(t("decorator.priorityInteger"));
                                }
                                if (value < 0 || value > maintainMax) {
                                    throw new Error(t("decorator.maintainOutOfRange"));
                                }
                            },
                        },
                    ]}
                >
                    <InputNumber
                        style={{ width: "100%" }}
                        disabled={readOnly}
                        precision={0}
                        step={1}
                        min={0}
                        max={maintainMax}
                        onBlur={commitMaintainPriority}
                    />
                </Form.Item>
                <Form.Item {...createInspectorLabelProps(t("decorator.abortType"))} name="abortType">
                    <Select
                        style={{ width: "100%" }}
                        disabled={readOnly}
                        options={ABORT_TYPES.map((value) => ({ value, label: value }))}
                        onChange={commitAbortType}
                    />
                </Form.Item>
                <Button
                    type="primary"
                    htmlType="button"
                    block
                    icon={<FormOutlined />}
                    className="b3-node-subtree-button"
                    onClick={() => {
                        if (webviewKind === "inspector-sidebar") {
                            runtime.hostAdapter.requestOpenDecoratorEditor(selectedNode.ref);
                            return;
                        }
                        void runtime.controller.openDecoratorEditor(selectedNode.ref);
                    }}
                >
                    {t("decorator.openEditor")}
                </Button>
            </Form>
        </div>
    );
};
