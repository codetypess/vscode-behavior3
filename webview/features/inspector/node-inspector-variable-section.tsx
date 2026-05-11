import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { AutoComplete, Button, Flex, Form } from "antd";
import type { FormInstance } from "antd/es/form";
import React from "react";
import { useTranslation } from "react-i18next";
import { checkOneof, parseSlotDefinition } from "../../shared/node-utils";
import type { NodeArg, VarDecl } from "../../shared/b3type";
import {
    OverrideBar,
    SectionDivider,
    createInspectorLabelProps,
    filterOptionByLabel,
} from "./inspector-shared";
import { validateVariableValue } from "./inspector-validation";
import type { VariableOption } from "./inspector-variable-options";
import type { SlotFieldName } from "./node-inspector-committers";

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

export const NodeVariableSection: React.FC<{
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
