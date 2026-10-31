import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Flex, Form, Input, Space, Tooltip } from "antd";
import type { FormInstance } from "antd/es/form";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { SectionDivider } from "./inspector-shared";
import {
    buildTreeCustomRecord,
    getTreeCustomValueKind,
    type TreeCustomRowValue,
    type TreeCustomValueKind,
} from "./inspector-form-values";

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

/** A key owned by the editor: its name is fixed and its value may use a dedicated control. */
export interface CustomDataReservedKey {
    key: string;
    /** Default false. */
    removable?: boolean;
    renderValue?: (props: {
        value: string;
        disabled: boolean;
        commit: (nextValue: string) => void;
    }) => React.ReactNode;
}

const CustomDataRow: React.FC<{
    value?: TreeCustomRowValue;
    disabled?: boolean;
    reservedKeys: CustomDataReservedKey[];
    onChange?: (next: TreeCustomRowValue) => void;
    onRemove?: () => void;
    onSubmit?: () => void;
}> = ({ value, disabled = false, reservedKeys, onChange, onRemove, onSubmit }) => {
    const { t } = useTranslation();
    const [localValue, setLocalValue] = React.useState<TreeCustomRowValue>(
        value ?? { key: "", value: "" }
    );
    const valueKind = getTreeCustomValueKind(localValue.value);

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
    const reserved = reservedKeys.find((entry) => entry.key === localValue.key?.trim());

    return (
        <Flex gap={4} align="start" className="b3-var-row">
            <Space.Compact block className="b3-var-row-compact">
                <Tooltip title={valueKindLabel}>
                    <div className={`b3-custom-type-badge is-${valueKind}`}>
                        <span
                            className={`codicon codicon-${getCustomValueBadgeIcon(valueKind)}`}
                            aria-hidden="true"
                        />
                    </div>
                </Tooltip>
                <Input
                    disabled={disabled || Boolean(reserved)}
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
                {reserved?.renderValue ? (
                    reserved.renderValue({
                        value: localValue.value ?? "",
                        disabled,
                        commit: (nextValue) => {
                            const updated = { ...localValue, value: nextValue };
                            setLocalValue(updated);
                            onChange?.(updated);
                            onSubmit?.();
                        },
                    })
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
            {disabled || (reserved && !reserved.removable) ? (
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
    reservedKeys?: CustomDataReservedKey[];
    queueCommit: () => void;
}> = ({ form, name, title, readOnly, reservedKeys = [], queueCommit }) => {
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
                                                buildTreeCustomRecord([
                                                    {
                                                        key,
                                                        value: value?.value ?? "",
                                                    },
                                                ]);
                                            } catch {
                                                throw new Error(t("validation.customValueInvalid"));
                                            }
                                        },
                                    },
                                ]}
                            >
                                <CustomDataRow
                                    disabled={readOnly}
                                    reservedKeys={reservedKeys}
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
