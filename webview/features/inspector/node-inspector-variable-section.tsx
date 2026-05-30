import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { AutoComplete, Button, Flex, Form } from "antd";
import type { FormInstance } from "antd/es/form";
import React from "react";
import { useTranslation } from "react-i18next";
import { parseSlotDefinition, type NodeSlotDef } from "../../shared/node-utils";
import type { NodeArg, VarDecl } from "../../shared/b3type";
import type { NodeFieldDiagnostic } from "../../shared/contracts";
import { validateNodeArgOneof } from "../../shared/validation";
import {
    OverrideBar,
    SectionDivider,
    createInspectorLabelProps,
    filterOptionByLabel,
} from "./inspector-shared";
import { getNodeSlotFormValue } from "./inspector-form-values";
import {
    compareJsonValue,
    formatValidationDiagnostic,
    validateVariableValue,
} from "./inspector-validation";
import type { VariableOption } from "./inspector-variable-options";
import type { SlotFieldName } from "./node-inspector-committers";

const NodeVariableField: React.FC<{
    form: FormInstance;
    fieldName: SlotFieldName;
    slotDefs: NodeSlotDef[];
    slot: NodeSlotDef;
    index: number;
    usingVars: Record<string, VarDecl> | null;
    variableOptions: VariableOption[];
    fieldEditDisabled: boolean;
    fieldKind: "input" | "output";
    currentSlotValue: string | string[] | undefined;
    nodeFieldDiagnostics: NodeFieldDiagnostic[];
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
    fieldKind,
    currentSlotValue,
    nodeFieldDiagnostics,
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
        if (relatedArg) {
            const oneofDiagnostic = validateNodeArgOneof({
                arg: relatedArg,
                argValue: form.getFieldValue(["args", relatedArg.name]),
                inputValues: form.getFieldValue("inputSlots"),
                inputDefs: slotDefs,
            });
            if (oneofDiagnostic) {
                throw new Error(formatValidationDiagnostic(oneofDiagnostic));
            }
        }

        const customDiagnostic = nodeFieldDiagnostics.find(
            (entry) => entry.fieldKind === fieldKind && entry.fieldIndex === index
        );
        const normalizedValue = variadic
            ? (((form.getFieldValue([fieldName, index]) as string[] | undefined) ?? []) as string[])
            : typeof value === "string"
              ? value
              : "";
        if (customDiagnostic && compareJsonValue(normalizedValue, currentSlotValue ?? "")) {
            throw new Error(customDiagnostic.message);
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
    slotDefs?: NodeSlotDef[];
    usingVars: Record<string, VarDecl> | null;
    variableOptions: VariableOption[];
    fieldEditDisabled: boolean;
    visibility?: Readonly<Record<number, boolean>>;
    currentSlots?: string[];
    nodeFieldDiagnostics: NodeFieldDiagnostic[];
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
    visibility,
    currentSlots,
    nodeFieldDiagnostics,
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
            {slotDefs
                .map((slot, index) => ({ slot, index }))
                .filter(({ index }) => visibility?.[index] !== false)
                .map(({ slot, index }) => {
                    const slotDefinition = parseSlotDefinition(slot, slotDefs, index);
                    return (
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
                            fieldKind={fieldName === "inputSlots" ? "input" : "output"}
                            currentSlotValue={getNodeSlotFormValue(
                                currentSlots,
                                index,
                                slotDefinition.variadic
                            )}
                            nodeFieldDiagnostics={nodeFieldDiagnostics}
                            isOverridden={isOverridden}
                            onReset={onReset}
                            onCommit={() => onCommit(index, slotDefinition.variadic)}
                            onQueueCommit={() => onQueueCommit(index, slotDefinition.variadic)}
                            getRelatedArg={getRelatedArg}
                        />
                    );
                })}
        </>
    );
};
