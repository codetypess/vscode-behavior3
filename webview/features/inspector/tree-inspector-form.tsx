import { FormOutlined, MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { AutoComplete, Button, Flex, Form, Input, Select, Switch } from "antd";
import type { FormInstance } from "antd/es/form";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useRuntime } from "../../app/runtime";
import { isValidVariableName } from "../../shared/misc/b3util";
import {
    SectionDivider,
    VariableDeclRow,
    type VariableRowValue,
    createInspectorLabelProps,
    filterOptionByLabel,
    queueSubmit,
    trackPendingInspectorEdit,
} from "./inspector-shared";
import {
    createTreeInspectorFormValues,
    createTreeMetaPayload,
    useTreeInspectorViewState,
} from "./inspector-state";
import { useInspectorMode } from "./inspector-mode";

const { TextArea } = Input;

const TreeMetaFields: React.FC<{
    form: FormInstance;
    groupDefs: string[];
    readOnly: boolean;
}> = ({ form, groupDefs, readOnly }) => {
    const { t } = useTranslation();
    const submitTreeForm = () => {
        void form.submit();
    };

    return (
        <>
            <Form.Item {...createInspectorLabelProps(t("tree.name"))} name="name">
                <Input disabled />
            </Form.Item>
            <Form.Item {...createInspectorLabelProps(t("tree.desc"))} name="desc">
                <TextArea autoSize={{ minRows: 1 }} disabled={readOnly} onBlur={submitTreeForm} />
            </Form.Item>
            <Form.Item {...createInspectorLabelProps(t("tree.prefix"))} name="prefix">
                <Input disabled={readOnly} onBlur={submitTreeForm} />
            </Form.Item>
            <Form.Item
                {...createInspectorLabelProps(t("tree.export"))}
                name="export"
                valuePropName="checked"
            >
                <Switch disabled={readOnly} onChange={() => queueSubmit(form)} />
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
                            onChange={() => queueSubmit(form)}
                        />
                    </Form.Item>
                </>
            ) : null}
        </>
    );
};

const LocalVariablesSection: React.FC<{
    form: FormInstance;
    onFocusVariable: (name: string) => void;
    readOnly: boolean;
}> = ({ form, onFocusVariable, readOnly }) => {
    const { t } = useTranslation();
    const submitTreeForm = () => {
        void form.submit();
    };

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
                                    onSubmit={submitTreeForm}
                                    onRemove={() => {
                                        remove(field.name);
                                        queueSubmit(form);
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
    form: FormInstance;
    allFiles: string[];
    currentImportRefs: Array<{ path?: string }>;
    importDeclByPath: Map<string, VariableRowValue[]>;
    onFocusVariable: (name: string) => void;
    readOnly: boolean;
}> = ({ form, allFiles, currentImportRefs, importDeclByPath, onFocusVariable, readOnly }) => {
    const { t } = useTranslation();
    const submitTreeForm = () => {
        void form.submit();
    };

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
                                                onBlur={submitTreeForm}
                                                onSelect={() => queueSubmit(form)}
                                            />
                                        </Form.Item>
                                        {readOnly ? null : (
                                            <MinusCircleOutlined
                                                className="b3-inline-remove-compact"
                                                onClick={() => {
                                                    remove(field.name);
                                                    queueSubmit(form);
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

export const TreeInspectorForm: React.FC = () => {
    const runtime = useRuntime();
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
        if (window.__B3_WEBVIEW_KIND__ === "inspector-sidebar") {
            runtime.hostAdapter.requestFocusVariable([name]);
            return;
        }
        void runtime.controller.focusVariable([name]);
    };

    const openSubtree = (path: string) => {
        void runtime.controller.openSubtreePath(path);
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
                onFinish={(values) => {
                    if (readOnly) {
                        return;
                    }
                    trackPendingInspectorEdit(
                        runtime.controller.updateTreeMeta(createTreeMetaPayload(values))
                    );
                }}
            >
                <TreeMetaFields form={form} groupDefs={groupDefs} readOnly={readOnly} />
                <LocalVariablesSection
                    form={form}
                    onFocusVariable={focusVariable}
                    readOnly={readOnly}
                />
                <SubtreeVariablesSection
                    rows={subtreeRows}
                    onOpenSubtree={openSubtree}
                    onFocusVariable={focusVariable}
                    readOnly={readOnly}
                />
                <ImportRefsSection
                    form={form}
                    allFiles={allFiles}
                    currentImportRefs={currentImportRefs}
                    importDeclByPath={importDeclByPath}
                    onFocusVariable={focusVariable}
                    readOnly={readOnly}
                />
            </Form>
        </div>
    );
};
