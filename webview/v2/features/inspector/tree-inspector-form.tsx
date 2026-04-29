import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { AutoComplete, Button, Flex, Form, Input, Select, Switch, Typography } from "antd";
import React, { useEffect, useMemo } from "react";
import { isValidVariableName } from "../../../shared/misc/b3util";
import { useDocumentStore, useRuntime, useWorkspaceStore } from "../../app/runtime";
import {
    SectionDivider,
    VariableDeclRow,
    type VariableRowValue,
    buildVariableUsageCount,
    createNodeDefMap,
    filterOptionByLabel,
    queueSubmit,
} from "./inspector-shared";

const { TextArea } = Input;

type ImportRefFormValue = {
    path?: string;
    vars?: VariableRowValue[];
};

export const TreeInspectorForm: React.FC = () => {
    const runtime = useRuntime();
    const document = useDocumentStore((state) => state.persistedTree);
    const nodeDefs = useWorkspaceStore((state) => state.nodeDefs);
    const groupDefs = useWorkspaceStore((state) => state.groupDefs);
    const allFiles = useWorkspaceStore((state) => state.allFiles);
    const importDecls = useWorkspaceStore((state) => state.importDecls);
    const subtreeDecls = useWorkspaceStore((state) => state.subtreeDecls);
    const [form] = Form.useForm();

    const nodeDefMap = useMemo(() => createNodeDefMap(nodeDefs), [nodeDefs]);
    const variableUsageCount = useMemo(
        () => buildVariableUsageCount(document?.root ?? null, nodeDefMap),
        [document?.root, nodeDefMap]
    );
    const currentImportRefs =
        (Form.useWatch("importRefs", form) as ImportRefFormValue[] | undefined) ?? [];

    const subtreeRows = useMemo(
        () =>
            subtreeDecls.map((entry) => ({
                ...entry,
                vars: entry.vars.map((variable) => ({
                    ...variable,
                    count: variableUsageCount[variable.name] ?? 0,
                })),
            })),
        [subtreeDecls, variableUsageCount]
    );

    const importDeclByPath = useMemo(() => {
        const record = new Map<string, VariableRowValue[]>();
        importDecls.forEach((entry) => {
            record.set(
                entry.path,
                entry.vars.map((variable) => ({
                    ...variable,
                    count: variableUsageCount[variable.name] ?? 0,
                }))
            );
        });
        return record;
    }, [importDecls, variableUsageCount]);

    useEffect(() => {
        if (!document) {
            return;
        }

        form.setFieldsValue({
            name: document.name,
            desc: document.desc ?? "",
            prefix: document.prefix ?? "",
            export: document.export !== false,
            group: document.group,
            vars: document.vars.map((variable) => ({
                ...variable,
                count: variableUsageCount[variable.name] ?? 0,
            })),
            importRefs: document.import.map((path) => ({ path })),
        });
    }, [document, form, variableUsageCount]);

    if (!document) {
        return null;
    }

    return (
        <>
            <div className="b3-v2-inspector-header">
                <Typography.Title level={5} style={{ margin: 0 }}>
                    Tree Overview
                </Typography.Title>
            </div>
            <div className="b3-v2-inspector-content">
                <Form
                    form={form}
                    className="b3-v2-inspector-form"
                    labelCol={{ span: "auto" }}
                    wrapperCol={{ span: "auto" }}
                    labelAlign="left"
                    onFinish={(values) => {
                        void runtime.controller.updateTreeMeta({
                            desc: values.desc?.trim() || undefined,
                            prefix: values.prefix ?? "",
                            export: values.export !== false,
                            group: values.group ?? [],
                            importRefs: ((values.importRefs ?? []) as Array<{ path?: string }>)
                                .map((entry) => entry.path?.trim())
                                .filter((entry): entry is string => Boolean(entry)),
                            vars: ((values.vars ?? []) as VariableRowValue[])
                                .filter((entry) => entry.name?.trim())
                                .map((entry) => ({
                                    name: entry.name.trim(),
                                    desc: entry.desc.trim(),
                                })),
                        });
                    }}
                >
                    <Form.Item label="Name" name="name">
                        <Input disabled />
                    </Form.Item>
                    <Form.Item label="Description" name="desc">
                        <TextArea
                            autoSize={{ minRows: 2, maxRows: 5 }}
                            onBlur={() => void form.submit()}
                        />
                    </Form.Item>
                    <Form.Item label="ID Prefix" name="prefix">
                        <Input onBlur={() => void form.submit()} />
                    </Form.Item>
                    <Form.Item label="Export" name="export" valuePropName="checked">
                        <Switch onChange={() => queueSubmit(form)} />
                    </Form.Item>

                    {groupDefs.length > 0 ? (
                        <>
                            <SectionDivider>Groups</SectionDivider>
                            <Form.Item label="Group" name="group">
                                <Select
                                    mode="multiple"
                                    placeholder="Select groups"
                                    options={groupDefs.map((group) => ({
                                        label: group,
                                        value: group,
                                    }))}
                                    onChange={() => queueSubmit(form)}
                                />
                            </Form.Item>
                        </>
                    ) : null}

                    <SectionDivider>Local Vars</SectionDivider>
                    <Form.List name="vars">
                        {(fields, { add, remove }, { errors }) => (
                            <div className="b3-v2-list-block">
                                {fields.map((field) => (
                                    <Form.Item
                                        key={field.key}
                                        name={field.name}
                                        style={{ marginBottom: 2 }}
                                        validateTrigger={["onChange", "onBlur"]}
                                        rules={[
                                            {
                                                validator: async (_, value: VariableRowValue) => {
                                                    if (
                                                        !value?.name ||
                                                        !isValidVariableName(value.name)
                                                    ) {
                                                        throw new Error("Invalid variable name");
                                                    }
                                                    if (!value.desc?.trim()) {
                                                        throw new Error(
                                                            "Variable description is required"
                                                        );
                                                    }
                                                },
                                            },
                                        ]}
                                    >
                                        <VariableDeclRow
                                            onSubmit={() => void form.submit()}
                                            onRemove={() => {
                                                remove(field.name);
                                                queueSubmit(form);
                                            }}
                                            onFocusVariable={(name) =>
                                                void runtime.controller.focusVariable([name])
                                            }
                                        />
                                    </Form.Item>
                                ))}
                                <Form.Item style={{ marginBottom: 0, marginTop: 4 }}>
                                    <Button
                                        type="dashed"
                                        block
                                        icon={<PlusOutlined />}
                                        onClick={() => add({ name: "", desc: "" })}
                                    >
                                        Add Variable
                                    </Button>
                                    <Form.ErrorList errors={errors} />
                                </Form.Item>
                            </div>
                        )}
                    </Form.List>

                    {subtreeRows.length > 0 ? (
                        <>
                            <SectionDivider>Subtree Vars</SectionDivider>
                            <div className="b3-v2-list-block">
                                {subtreeRows.map((entry) => (
                                    <div key={entry.path} className="b3-v2-decl-group">
                                        <Form.Item label="Path" style={{ marginBottom: 2 }}>
                                            <Input value={entry.path} disabled />
                                        </Form.Item>
                                        <div className="b3-v2-decl-vars">
                                            {entry.vars.map((variable) => (
                                                <VariableDeclRow
                                                    key={`${entry.path}:${variable.name}`}
                                                    value={variable}
                                                    disabled
                                                    onFocusVariable={(name) =>
                                                        void runtime.controller.focusVariable([
                                                            name,
                                                        ])
                                                    }
                                                />
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : null}

                    <SectionDivider>Import Vars</SectionDivider>
                    <Form.List name="importRefs">
                        {(fields, { add, remove }, { errors }) => (
                            <div className="b3-v2-list-block">
                                {fields.map((field) => {
                                    const currentPath =
                                        currentImportRefs[field.name]?.path?.trim() ?? "";
                                    const importVars = currentPath
                                        ? (importDeclByPath.get(currentPath) ?? [])
                                        : [];

                                    return (
                                        <div key={field.key} className="b3-v2-decl-group">
                                            <Flex gap={4} align="start">
                                                <Form.Item
                                                    label="Path"
                                                    name={[field.name, "path"]}
                                                    style={{ flex: 1, marginBottom: 2 }}
                                                >
                                                    <AutoComplete
                                                        options={allFiles.map((path) => ({
                                                            label: path,
                                                            value: path,
                                                        }))}
                                                        filterOption={filterOptionByLabel}
                                                        onBlur={() => void form.submit()}
                                                        onSelect={() => queueSubmit(form)}
                                                    />
                                                </Form.Item>
                                                <MinusCircleOutlined
                                                    className="b3-v2-inline-remove"
                                                    onClick={() => {
                                                        remove(field.name);
                                                        queueSubmit(form);
                                                    }}
                                                />
                                            </Flex>
                                            <div className="b3-v2-decl-vars">
                                                {importVars.map((variable) => (
                                                    <VariableDeclRow
                                                        key={`${currentPath}:${variable.name}`}
                                                        value={variable}
                                                        disabled
                                                        onFocusVariable={(name) =>
                                                            void runtime.controller.focusVariable([
                                                                name,
                                                            ])
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
                                        icon={<PlusOutlined />}
                                        onClick={() => add({ path: "" })}
                                    >
                                        Add Import
                                    </Button>
                                    <Form.ErrorList errors={errors} />
                                </Form.Item>
                            </div>
                        )}
                    </Form.List>
                </Form>
            </div>
        </>
    );
};
