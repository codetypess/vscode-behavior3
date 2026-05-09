import { FormOutlined, MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { AutoComplete, Button, Flex, Form, Input, Select, Space, Switch, Tooltip } from "antd";
import type { FormInstance } from "antd/es/form";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useRuntime, useWebviewKind } from "../../app/runtime";
import { isValidVariableName } from "../../shared/validation";
import {
    SectionDivider,
    VariableDeclRow,
    createInspectorLabelProps,
    createInspectorSwitchLabelProps,
    filterOptionByLabel,
} from "./inspector-shared";
import type { VariableRowValue } from "./inspector-variable-options";
import { queueInspectorTask, trackPendingInspectorEdit } from "./inspector-commit-queue";
import { useTreeInspectorViewState } from "./inspector-state";
import {
    buildTreeCustomRecord,
    createTreeMetaPayload,
    createTreeInspectorFormValues,
    getTreeCustomValueKind,
    type TreeCustomRowValue,
    type TreeCustomValueKind,
} from "./inspector-form-values";
import { useInspectorMode } from "./inspector-mode";

const { TextArea } = Input;

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

const TreeMetaFields: React.FC<{
    groupDefs: string[];
    readOnly: boolean;
    commitFields: (fields: string[]) => void;
    queueCommitFields: (fields: string[]) => void;
}> = ({ groupDefs, readOnly, commitFields, queueCommitFields }) => {
    const { t } = useTranslation();

    return (
        <>
            <Form.Item {...createInspectorLabelProps(t("tree.name"))} name="name">
                <Input disabled />
            </Form.Item>
            <Form.Item {...createInspectorLabelProps(t("tree.desc"))} name="desc">
                <TextArea
                    autoSize={{ minRows: 1 }}
                    disabled={readOnly}
                    onBlur={() => commitFields(["desc"])}
                />
            </Form.Item>
            <Form.Item {...createInspectorLabelProps(t("tree.prefix"))} name="prefix">
                <Input disabled={readOnly} onBlur={() => commitFields(["prefix"])} />
            </Form.Item>
            <Form.Item
                {...createInspectorSwitchLabelProps(t("tree.export"))}
                name="export"
                valuePropName="checked"
            >
                <Switch disabled={readOnly} onChange={() => queueCommitFields(["export"])} />
            </Form.Item>

            {groupDefs.length > 0 ? (
                <>
                    <SectionDivider>{t("tree.group")}</SectionDivider>
                    <Form.Item name="group">
                        <Select
                            mode="multiple"
                            disabled={readOnly}
                            placeholder={t("tree.group.placeholder")}
                            options={groupDefs.map((group) => ({
                                label: group,
                                value: group,
                            }))}
                            onChange={() => queueCommitFields(["group"])}
                        />
                    </Form.Item>
                </>
            ) : null}
        </>
    );
};

const LocalVariablesSection: React.FC<{
    onFocusVariable: (name: string) => void;
    readOnly: boolean;
    commitVars: () => void;
    queueCommitVars: () => void;
}> = ({ onFocusVariable, readOnly, commitVars, queueCommitVars }) => {
    const { t } = useTranslation();

    return (
        <>
            <SectionDivider>{t("tree.vars.local")}</SectionDivider>
            <Form.List name="vars">
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
                                        validator: async (_, value: VariableRowValue) => {
                                            if (!value?.name || !isValidVariableName(value.name)) {
                                                throw new Error(t("tree.vars.invalidName"));
                                            }
                                            if (!value.desc?.trim()) {
                                                throw new Error(
                                                    t("validation.variableDescriptionRequired")
                                                );
                                            }
                                        },
                                    },
                                ]}
                            >
                                <VariableDeclRow
                                    disabled={readOnly}
                                    onSubmit={queueCommitVars}
                                    onRemove={() => {
                                        remove(field.name);
                                        queueCommitVars();
                                    }}
                                    onFocusVariable={readOnly ? undefined : onFocusVariable}
                                />
                            </Form.Item>
                        ))}
                        <Form.Item style={{ marginBottom: 0, marginTop: 4 }}>
                            <Button
                                type="dashed"
                                block
                                disabled={readOnly}
                                icon={<PlusOutlined />}
                                onClick={() => add({ name: "", desc: "" })}
                            >
                                {t("tree.vars.add")}
                            </Button>
                            <Form.ErrorList errors={errors} />
                        </Form.Item>
                    </div>
                )}
            </Form.List>
        </>
    );
};

const SubtreeVariablesSection: React.FC<{
    rows: Array<{ path: string; vars: VariableRowValue[] }>;
    onOpenSubtree: (path: string) => void;
    onFocusVariable: (name: string) => void;
    readOnly: boolean;
}> = ({ rows, onOpenSubtree, onFocusVariable, readOnly }) => {
    const { t } = useTranslation();

    if (rows.length === 0) {
        return null;
    }

    return (
        <>
            <SectionDivider>{t("tree.vars.subtree")}</SectionDivider>
            <div className="b3-list-block">
                {rows.map((entry) => (
                    <div key={entry.path} className="b3-decl-group">
                        <Flex gap={4} align="center" className="b3-subtree-path-row">
                            <Form.Item style={{ flex: 1, marginBottom: 0 }}>
                                <Input value={entry.path} disabled />
                            </Form.Item>
                            {readOnly ? null : (
                                <FormOutlined
                                    className="b3-inline-action"
                                    onClick={() => onOpenSubtree(entry.path)}
                                />
                            )}
                        </Flex>
                        <div className="b3-decl-vars">
                            {entry.vars.map((variable) => (
                                <VariableDeclRow
                                    key={`${entry.path}:${variable.name}`}
                                    value={variable}
                                    disabled
                                    onFocusVariable={readOnly ? undefined : onFocusVariable}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </>
    );
};

const ImportRefsSection: React.FC<{
    allFiles: string[];
    currentImportRefs: Array<{ path?: string }>;
    importDeclByPath: Map<string, VariableRowValue[]>;
    onFocusVariable: (name: string) => void;
    readOnly: boolean;
    commitImportRefs: () => void;
    queueCommitImportRefs: () => void;
}> = ({
    allFiles,
    currentImportRefs,
    importDeclByPath,
    onFocusVariable,
    readOnly,
    commitImportRefs,
    queueCommitImportRefs,
}) => {
    const { t } = useTranslation();

    return (
        <>
            <SectionDivider>{t("tree.vars.imports")}</SectionDivider>
            <Form.List name="importRefs">
                {(fields, { add, remove }, { errors }) => (
                    <div className="b3-list-block">
                        {fields.map((field) => {
                            const currentPath = currentImportRefs[field.name]?.path?.trim() ?? "";
                            const importVars = currentPath
                                ? (importDeclByPath.get(currentPath) ?? [])
                                : [];

                            return (
                                <div key={field.key} className="b3-decl-group">
                                    <Flex gap={4} align="center" className="b3-subtree-path-row">
                                        <Form.Item
                                            name={[field.name, "path"]}
                                            style={{ flex: 1, marginBottom: 0 }}
                                        >
                                            <AutoComplete
                                                disabled={readOnly}
                                                options={allFiles.map((path) => ({
                                                    label: path,
                                                    value: path,
                                                }))}
                                                filterOption={filterOptionByLabel}
                                                onBlur={commitImportRefs}
                                                onSelect={queueCommitImportRefs}
                                            />
                                        </Form.Item>
                                        {readOnly ? null : (
                                            <MinusCircleOutlined
                                                className="b3-inline-remove-compact"
                                                onClick={() => {
                                                    remove(field.name);
                                                    queueCommitImportRefs();
                                                }}
                                            />
                                        )}
                                    </Flex>
                                    <div className="b3-decl-vars">
                                        {importVars.map((variable) => (
                                            <VariableDeclRow
                                                key={`${currentPath}:${variable.name}`}
                                                value={variable}
                                                disabled
                                                onFocusVariable={
                                                    readOnly ? undefined : onFocusVariable
                                                }
                                            />
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                        <Form.Item style={{ marginBottom: 0, marginTop: 4 }}>
                            <Button
                                type="dashed"
                                block
                                disabled={readOnly}
                                icon={<PlusOutlined />}
                                onClick={() => add({ path: "" })}
                            >
                                {t("tree.import.add")}
                            </Button>
                            <Form.ErrorList errors={errors} />
                        </Form.Item>
                    </div>
                )}
            </Form.List>
        </>
    );
};

const TreeCustomRow: React.FC<{
    value?: TreeCustomRowValue;
    disabled?: boolean;
    onChange?: (next: TreeCustomRowValue) => void;
    onRemove?: () => void;
    onSubmit?: () => void;
}> = ({ value, disabled = false, onChange, onRemove, onSubmit }) => {
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
                    disabled={disabled}
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
            </Space.Compact>
            {disabled ? (
                <div className="b3-row-spacer" />
            ) : (
                <MinusCircleOutlined className="b3-inline-remove" onClick={onRemove} />
            )}
        </Flex>
    );
};

const CustomDataSection: React.FC<{
    form: FormInstance;
    readOnly: boolean;
    queueCommitCustomRows: () => void;
}> = ({ form, readOnly, queueCommitCustomRows }) => {
    const { t } = useTranslation();

    return (
        <>
            <SectionDivider>{t("tree.custom")}</SectionDivider>
            <Form.List name="customRows">
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

                                            const customRows =
                                                (form.getFieldValue("customRows") as
                                                    | TreeCustomRowValue[]
                                                    | undefined) ?? [];
                                            const duplicateCount = customRows.filter(
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
                                <TreeCustomRow
                                    disabled={readOnly}
                                    onSubmit={queueCommitCustomRows}
                                    onRemove={() => {
                                        remove(field.name);
                                        queueCommitCustomRows();
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

export const TreeInspectorForm: React.FC = () => {
    const runtime = useRuntime();
    const webviewKind = useWebviewKind();
    const { readOnly } = useInspectorMode();
    const [form] = Form.useForm();
    const {
        document,
        groupDefs,
        allFiles,
        variableUsageCount,
        currentImportRefs,
        subtreeRows,
        importDeclByPath,
    } = useTreeInspectorViewState(form);

    useEffect(() => {
        if (!document) {
            return;
        }

        form.setFieldsValue(createTreeInspectorFormValues(document, variableUsageCount));
    }, [document, form, variableUsageCount]);

    if (!document) {
        return null;
    }

    const focusVariable = (name: string) => {
        if (webviewKind === "inspector-sidebar") {
            runtime.hostAdapter.requestFocusVariable([name]);
            return;
        }
        void runtime.controller.focusVariable([name]);
    };

    const openSubtree = (path: string) => {
        void runtime.controller.openSubtreePath(path);
    };

    const commitTreeFields = async (fields: string[]) => {
        if (readOnly) {
            return;
        }

        try {
            await form.validateFields(fields, { recursive: true });
        } catch {
            return;
        }

        const values = form.getFieldsValue(true);
        const payload = createTreeMetaPayload(
            createTreeInspectorFormValues(document, variableUsageCount)
        );

        switch (fields[0]) {
            case "desc":
                payload.desc = values.desc?.trim() || undefined;
                break;
            case "prefix":
                payload.prefix = values.prefix ?? "";
                break;
            case "export":
                payload.export = values.export !== false;
                break;
            case "group":
                payload.group = values.group ?? [];
                break;
            case "vars":
                payload.variables.locals = (values.vars ?? [])
                    .filter((entry: VariableRowValue) => entry.name?.trim())
                    .map((entry: VariableRowValue) => ({
                        name: entry.name.trim(),
                        desc: entry.desc.trim(),
                    }));
                break;
            case "importRefs":
                payload.variables.imports = (values.importRefs ?? [])
                    .map((entry: { path?: string }) => entry.path?.trim())
                    .filter((entry: string | undefined): entry is string => Boolean(entry));
                break;
            case "customRows":
                payload.custom = buildTreeCustomRecord(values.customRows ?? []);
                break;
            default:
                return;
        }

        trackPendingInspectorEdit(runtime.controller.updateTreeMeta(payload));
    };

    const queueCommitTreeFields = (fields: string[]) => {
        queueInspectorTask(() => {
            void commitTreeFields(fields);
        });
    };

    return (
        <div className="b3-inspector-content">
            <Form
                form={form}
                className="b3-inspector-form"
                labelCol={{ flex: "110px", xs: { flex: "110px" } }}
                wrapperCol={{ flex: "1 1 0%", xs: { flex: "1 1 0%" } }}
                labelAlign="right"
                requiredMark={false}
            >
                <TreeMetaFields
                    groupDefs={groupDefs}
                    readOnly={readOnly}
                    commitFields={commitTreeFields}
                    queueCommitFields={queueCommitTreeFields}
                />
                <LocalVariablesSection
                    onFocusVariable={focusVariable}
                    readOnly={readOnly}
                    commitVars={() => void commitTreeFields(["vars"])}
                    queueCommitVars={() => queueCommitTreeFields(["vars"])}
                />
                <SubtreeVariablesSection
                    rows={subtreeRows}
                    onOpenSubtree={openSubtree}
                    onFocusVariable={focusVariable}
                    readOnly={readOnly}
                />
                <ImportRefsSection
                    allFiles={allFiles}
                    currentImportRefs={currentImportRefs}
                    importDeclByPath={importDeclByPath}
                    onFocusVariable={focusVariable}
                    readOnly={readOnly}
                    commitImportRefs={() => void commitTreeFields(["importRefs"])}
                    queueCommitImportRefs={() => queueCommitTreeFields(["importRefs"])}
                />
                <CustomDataSection
                    form={form}
                    readOnly={readOnly}
                    queueCommitCustomRows={() => queueCommitTreeFields(["customRows"])}
                />
            </Form>
        </div>
    );
};
