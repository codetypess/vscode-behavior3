import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Flex, Form, Input, InputNumber, Select, Space, Switch, Tooltip } from "antd";
import type { FormInstance } from "antd/es/form";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { SectionDivider } from "./inspector-shared";
import type { CustomFieldDef, CustomFieldValue } from "../../shared/b3type";
import {
    buildTreeCustomRecord,
    getTreeCustomValueKind,
    type TreeCustomRowValue,
    type TreeCustomValueKind,
} from "./inspector-form-values";
import {
    CustomFieldValueError,
    formatCustomRowValue,
    parseCustomFieldInput,
} from "./tree-custom-metadata";

const getCustomValueBadgeIcon = (kind: TreeCustomValueKind) => {
    switch (kind) {
        case "number":
            return "symbol-numeric";
        case "boolean":
            return "symbol-boolean";
        case "invalid":
            return "error";
        default:
            return "symbol-string";
    }
};

const getCustomFieldValueKind = (def: CustomFieldDef, rawValue: string | undefined) => {
    try {
        parseCustomFieldInput(def, rawValue);
    } catch {
        return "invalid";
    }
    switch (def.type) {
        case "bool":
            return "boolean";
        case "int":
        case "float":
            return "number";
        default:
            return "string";
    }
};

const CustomFieldValueInput: React.FC<{
    def: CustomFieldDef;
    value: string;
    disabled: boolean;
    onChange: (nextValue: string) => void;
    commit: (nextValue: string) => void;
}> = ({ def, value, disabled, onChange, commit }) => {
    const { t } = useTranslation();
    if (def.options) {
        let selected: CustomFieldValue | undefined;
        try {
            selected = parseCustomFieldInput(def, value);
        } catch {
            selected = undefined;
        }
        return (
            <Select
                disabled={disabled}
                style={{ width: "100%" }}
                value={selected}
                placeholder={value}
                options={def.options.map((option) => ({
                    value: option.value,
                    label:
                        option.name === String(option.value)
                            ? option.name
                            : `${option.name} (${String(option.value)})`,
                }))}
                onChange={(next: CustomFieldValue) => commit(formatCustomRowValue(next))}
            />
        );
    }
    if (def.type === "bool") {
        return (
            <div className="b3-custom-switch">
                <Switch
                    disabled={disabled}
                    checked={value.trim() === "true"}
                    onChange={(checked) => commit(String(checked))}
                />
            </div>
        );
    }
    if (def.type === "int" || def.type === "float") {
        const parsed = Number(value);
        return (
            <InputNumber
                disabled={disabled}
                style={{ width: "100%" }}
                precision={def.type === "int" ? 0 : undefined}
                value={value.trim() && Number.isFinite(parsed) ? parsed : null}
                placeholder={t("tree.custom.value")}
                onChange={(next) => onChange(next === null ? "" : String(next))}
                onBlur={() => commit(value)}
            />
        );
    }
    return (
        <Input
            disabled={disabled}
            value={value}
            placeholder={t("tree.custom.value")}
            onChange={(event) => onChange(event.target.value)}
            onBlur={() => commit(value)}
        />
    );
};

const CustomDataRow: React.FC<{
    value?: TreeCustomRowValue;
    disabled?: boolean;
    fields: CustomFieldDef[];
    onChange?: (next: TreeCustomRowValue) => void;
    onRemove?: () => void;
    onSubmit?: () => void;
}> = ({ value, disabled = false, fields, onChange, onRemove, onSubmit }) => {
    const { t } = useTranslation();
    const [localValue, setLocalValue] = React.useState<TreeCustomRowValue>(
        value ?? { key: "", value: "" }
    );
    // Lock the row once a declared key is committed, so typing a longer key is not cut off.
    const def = fields.find((entry) => entry.key === value?.key?.trim());
    const valueKind = def
        ? getCustomFieldValueKind(def, localValue.value)
        : getTreeCustomValueKind(localValue.value);

    const valueKindLabel = (() => {
        switch (valueKind) {
            case "number":
                return t("tree.custom.type.number");
            case "boolean":
                return t("tree.custom.type.boolean");
            case "invalid":
                return t("tree.custom.type.invalid");
            default:
                return t("tree.custom.type.string");
        }
    })();

    useEffect(() => {
        setLocalValue(value ?? { key: "", value: "" });
    }, [value]);

    const commit = () => {
        onChange?.(localValue);
        onSubmit?.();
    };
    const commitValue = (nextValue: string) => {
        const updated = { ...localValue, value: nextValue };
        setLocalValue(updated);
        onChange?.(updated);
        onSubmit?.();
    };

    const keyInput = (
        <Input
            disabled={disabled || Boolean(def)}
            value={localValue.key}
            placeholder={t("tree.custom.key")}
            onChange={(event) =>
                setLocalValue((current) => ({
                    ...current,
                    key: event.target.value,
                }))
            }
            onBlur={commit}
        />
    );

    return (
        <Flex
            gap={4}
            align="start"
            className={value?.pending ? "b3-var-row is-pending" : "b3-var-row"}
        >
            <Space.Compact block className="b3-var-row-compact">
                <Tooltip title={valueKindLabel}>
                    <div className={`b3-custom-type-badge is-${valueKind}`}>
                        <span
                            className={`codicon codicon-${getCustomValueBadgeIcon(valueKind)}`}
                            aria-hidden="true"
                        />
                    </div>
                </Tooltip>
                {def?.desc || def?.script || value?.pending ? (
                    <Tooltip
                        title={[
                            def?.desc,
                            def?.script ? t("tree.custom.script", { name: def.script }) : undefined,
                            value?.pending ? t("tree.custom.pending") : undefined,
                        ]
                            .filter(Boolean)
                            .join(" · ")}
                    >
                        {keyInput}
                    </Tooltip>
                ) : (
                    keyInput
                )}
                {def ? (
                    <CustomFieldValueInput
                        def={def}
                        value={localValue.value ?? ""}
                        disabled={disabled || !def.editable}
                        onChange={(nextValue) =>
                            setLocalValue((current) => ({ ...current, value: nextValue }))
                        }
                        commit={commitValue}
                    />
                ) : (
                    <Input
                        disabled={disabled}
                        value={localValue.value}
                        placeholder={t("tree.custom.value")}
                        onChange={(event) =>
                            setLocalValue((current) => ({
                                ...current,
                                value: event.target.value,
                            }))
                        }
                        onBlur={commit}
                    />
                )}
            </Space.Compact>
            {disabled || def?.required ? (
                <div className="b3-row-spacer" />
            ) : (
                <MinusCircleOutlined className="b3-inline-remove" onClick={onRemove} />
            )}
        </Flex>
    );
};

/** Key/value editor shared by the tree `custom` and the condition item `custom`. */
export const CustomDataSection: React.FC<{
    form: FormInstance;
    /** Form.List field holding `TreeCustomRowValue[]`. */
    name: string;
    title: string;
    readOnly: boolean;
    /** Declared fields that apply to this record. */
    fields?: CustomFieldDef[];
    queueCommit: () => void;
}> = ({ form, name, title, readOnly, fields: customFields = [], queueCommit }) => {
    const { t } = useTranslation();

    return (
        <>
            <SectionDivider>{title}</SectionDivider>
            <Form.List name={name}>
                {(fields, { add, remove }, { errors }) => (
                    <div className="b3-list-block">
                        {fields.map((field) => (
                            <Form.Item
                                key={field.key}
                                name={field.name}
                                style={{ marginBottom: 2 }}
                                validateTrigger={["onChange", "onBlur"]}
                                rules={[
                                    {
                                        validator: async (_, value: TreeCustomRowValue) => {
                                            const key = value?.key?.trim();
                                            if (!key) {
                                                throw new Error(t("validation.customKeyRequired"));
                                            }

                                            const rows =
                                                (form.getFieldValue(name) as
                                                    | TreeCustomRowValue[]
                                                    | undefined) ?? [];
                                            const duplicateCount = rows.filter(
                                                (entry) => entry?.key?.trim() === key
                                            ).length;
                                            if (duplicateCount > 1) {
                                                throw new Error(
                                                    t("validation.customKeyDuplicate", { key })
                                                );
                                            }

                                            try {
                                                buildTreeCustomRecord(
                                                    [{ key, value: value?.value ?? "" }],
                                                    customFields
                                                );
                                            } catch (error) {
                                                if (error instanceof CustomFieldValueError) {
                                                    throw new Error(
                                                        error.reason === "option"
                                                            ? t("validation.customFieldOption", {
                                                                  key,
                                                              })
                                                            : t("validation.customFieldType", {
                                                                  key,
                                                                  type: customFields.find(
                                                                      (entry) => entry.key === key
                                                                  )?.type,
                                                              })
                                                    );
                                                }
                                                throw new Error(t("validation.customValueInvalid"));
                                            }
                                        },
                                    },
                                ]}
                            >
                                <CustomDataRow
                                    disabled={readOnly}
                                    fields={customFields}
                                    onSubmit={queueCommit}
                                    onRemove={() => {
                                        remove(field.name);
                                        queueCommit();
                                    }}
                                />
                            </Form.Item>
                        ))}
                        <Form.Item style={{ marginBottom: 0, marginTop: 4 }}>
                            <Button
                                type="dashed"
                                block
                                disabled={readOnly}
                                icon={<PlusOutlined />}
                                onClick={() => add({ key: "", value: "" })}
                            >
                                {t("tree.custom.add")}
                            </Button>
                            <Form.ErrorList errors={errors} />
                        </Form.Item>
                    </div>
                )}
            </Form.List>
        </>
    );
};
