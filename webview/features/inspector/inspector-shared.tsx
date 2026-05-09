import { AimOutlined, MinusCircleOutlined } from "@ant-design/icons";
import { Divider, Flex, Input, Popconfirm, Space } from "antd";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useInspectorMode } from "./inspector-mode";
import type { VariableRowValue } from "./inspector-variable-options";

export const filterOptionByLabel = (input: string, option?: { label?: React.ReactNode }) =>
    String(option?.label ?? "")
        .toUpperCase()
        .includes(input.toUpperCase());

const getOverridePopupContainer = (trigger: HTMLElement) => {
    return (trigger.closest(".b3-inspector") as HTMLElement) ?? document.body;
};

export const OverrideBar: React.FC<{
    active: boolean;
    onReset: () => void;
    children: React.ReactNode;
}> = ({ active, onReset, children }) => {
    const { t } = useTranslation();
    const { readOnly } = useInspectorMode();

    if (!active || readOnly) {
        return <>{children}</>;
    }

    return (
        <div className="b3-override-bar">
            <Popconfirm
                title={t("override.resetTitle")}
                okText={t("reset")}
                cancelText={t("cancel")}
                placement="left"
                onConfirm={onReset}
                getPopupContainer={getOverridePopupContainer}
            >
                <div className="b3-override-rail" />
            </Popconfirm>
            {children}
        </div>
    );
};

export const SectionDivider: React.FC<React.PropsWithChildren> = ({ children }) => {
    return (
        <Divider className="b3-section-divider" titlePlacement="start" orientation="horizontal">
            <h4 className="b3-section-title">{children}</h4>
        </Divider>
    );
};

export const InspectorLabel: React.FC<{ text: string; required?: boolean }> = ({
    text,
    required,
}) => {
    return (
        <span className="b3-form-label">
            <span className="b3-form-label-text">
                {required ? <span className="b3-form-required-mark">*</span> : null}
                {text}
            </span>
            <span className="b3-form-label-colon">:</span>
        </span>
    );
};

export const createInspectorLabelProps = (text: string, required = false) => ({
    label: <InspectorLabel text={text} required={required} />,
    colon: false as const,
});

export const createInspectorSwitchLabelProps = (text: string, required = false) => ({
    ...createInspectorLabelProps(text, required),
    htmlFor: undefined,
});

export const VariableDeclRow: React.FC<{
    value?: VariableRowValue;
    disabled?: boolean;
    onChange?: (next: VariableRowValue) => void;
    onRemove?: () => void;
    onSubmit?: () => void;
    onFocusVariable?: (name: string) => void;
}> = ({ value, disabled = false, onChange, onRemove, onSubmit, onFocusVariable }) => {
    const { t } = useTranslation();
    const [localValue, setLocalValue] = useState<VariableRowValue>(value ?? { name: "", desc: "" });

    useEffect(() => {
        setLocalValue(value ?? { name: "", desc: "" });
    }, [value]);

    const commit = () => {
        onChange?.(localValue);
        onSubmit?.();
    };

    return (
        <Flex gap={4} align="start" className="b3-var-row">
            <Space.Compact block className="b3-var-row-compact">
                <div
                    className="b3-var-counter"
                    onClick={() => {
                        if (localValue.name) {
                            onFocusVariable?.(localValue.name);
                        }
                    }}
                >
                    <AimOutlined />
                    <span>{localValue.count ?? 0}</span>
                </div>
                <Input
                    disabled={disabled}
                    value={localValue.name}
                    placeholder={t("tree.vars.name")}
                    onChange={(event) =>
                        setLocalValue((current) => ({
                            ...current,
                            name: event.target.value,
                        }))
                    }
                    onBlur={commit}
                />
                <Input
                    disabled={disabled}
                    value={localValue.desc}
                    placeholder={t("tree.vars.desc")}
                    onChange={(event) =>
                        setLocalValue((current) => ({
                            ...current,
                            desc: event.target.value,
                        }))
                    }
                    onBlur={commit}
                />
            </Space.Compact>
            {disabled ? (
                <div className="b3-row-spacer" />
            ) : (
                <MinusCircleOutlined className="b3-inline-remove" onClick={onRemove} />
            )}
        </Flex>
    );
};
