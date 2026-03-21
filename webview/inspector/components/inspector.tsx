/**
 * Inspector sidebar panel for the VSCode extension.
 * Displays node or tree properties based on selection from the editor canvas.
 * Sends property changes back to the extension host via vscodeApi.postMessage.
 */
import {
  AimOutlined,
  MinusCircleOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import {
  AutoComplete,
  Button,
  Divider,
  Flex,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Typography,
} from "antd";
import React, { FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import { useDebounceCallback } from "usehooks-ts";
import {
  hasArgOptions,
  isBoolType,
  isExprType,
  isFloatType,
  isIntType,
  isJsonType,
  isStringType,
  NodeArg,
  NodeData,
  NodeDef,
  TreeData,
  VarDecl,
} from "@shared/misc/b3type";
import {
  checkNodeArgValue,
  getNodeArgOptions,
  getNodeArgRawType,
  isNodeArgArray,
  isNodeArgOptional,
  isValidVariableName,
  NodeDefs,
} from "@shared/misc/b3util";
import { postMessage } from "../vscodeApi";

const { Text } = Typography;

export type InspectorState =
  | { kind: "empty" }
  | {
      kind: "node";
      node: unknown;
      nodeDefs: unknown[];
      editingTree: unknown;
      workdir: string;
      checkExpr: boolean;
    }
  | {
      kind: "tree";
      tree: unknown;
      nodeDefs: unknown[];
      workdir: string;
      checkExpr: boolean;
    };

interface InspectorProps {
  state: InspectorState;
}

// ─── Node Inspector ──────────────────────────────────────────────────────────

const ArgField: FC<{
  arg: NodeArg;
  nodeData: NodeData;
  disabled: boolean;
  onChange: (key: string, value: unknown) => void;
}> = ({ arg, nodeData, disabled, onChange }) => {
  const { t } = useTranslation();
  const rawType = getNodeArgRawType(arg);
  const isArray = isNodeArgArray(arg);
  const isOptional = isNodeArgOptional(arg);
  const value = nodeData.args?.[arg.name];
  const options = getNodeArgOptions(arg, nodeData.args ?? {});

  const hasError = value !== undefined && !checkNodeArgValue(nodeData, arg, value);

  if (isArray) {
    const arrValue = (Array.isArray(value) ? value : []) as unknown[];
    return (
      <Form.Item label={<span title={arg.desc}>{arg.name}</span>} style={{ marginBottom: 4 }}>
        <Flex vertical gap={4}>
          {arrValue.map((v, i) => (
            <Flex key={i} gap={4} align="center">
              <Input
                disabled={disabled}
                value={String(v ?? "")}
                status={hasError ? "error" : undefined}
                onChange={(e) => {
                  const arr = [...arrValue];
                  arr[i] = e.target.value;
                  onChange(arg.name, arr);
                }}
              />
              {!disabled && (
                <MinusCircleOutlined
                  onClick={() => {
                    const arr = arrValue.filter((_, j) => j !== i);
                    onChange(arg.name, arr);
                  }}
                />
              )}
            </Flex>
          ))}
          {!disabled && (
            <Button
              size="small"
              icon={<PlusOutlined />}
              onClick={() => onChange(arg.name, [...arrValue, ""])}
            >
              {t("add")}
            </Button>
          )}
        </Flex>
      </Form.Item>
    );
  }

  if (options && options.length > 0) {
    return (
      <Form.Item label={<span title={arg.desc}>{arg.name}</span>} style={{ marginBottom: 4 }}>
        <Select
          disabled={disabled}
          value={value as string | undefined}
          allowClear={isOptional}
          status={hasError ? "error" : undefined}
          options={options.map((o) => ({ label: String(o.name), value: o.value }))}
          onChange={(v) => onChange(arg.name, v)}
        />
      </Form.Item>
    );
  }

  if (isBoolType(rawType)) {
    return (
      <Form.Item label={<span title={arg.desc}>{arg.name}</span>} style={{ marginBottom: 4 }}>
        <Switch
          disabled={disabled}
          checked={value as boolean | undefined}
          onChange={(v) => onChange(arg.name, v)}
        />
      </Form.Item>
    );
  }

  if (isIntType(rawType) || isFloatType(rawType)) {
    return (
      <Form.Item label={<span title={arg.desc}>{arg.name}</span>} style={{ marginBottom: 4 }}>
        <InputNumber
          disabled={disabled}
          value={value as number | undefined}
          status={hasError ? "error" : undefined}
          precision={isIntType(rawType) ? 0 : undefined}
          style={{ width: "100%" }}
          onChange={(v) => onChange(arg.name, v)}
        />
      </Form.Item>
    );
  }

  if (isJsonType(rawType)) {
    return (
      <Form.Item label={<span title={arg.desc}>{arg.name}</span>} style={{ marginBottom: 4 }}>
        <Input.TextArea
          disabled={disabled}
          value={value != null ? JSON.stringify(value) : ""}
          status={hasError ? "error" : undefined}
          autoSize={{ minRows: 1, maxRows: 6 }}
          onChange={(e) => {
            try {
              onChange(arg.name, JSON.parse(e.target.value));
            } catch {
              // keep raw string while typing
            }
          }}
        />
      </Form.Item>
    );
  }

  // string / expr / code
  return (
    <Form.Item label={<span title={arg.desc}>{arg.name}</span>} style={{ marginBottom: 4 }}>
      <Input
        disabled={disabled}
        value={value as string | undefined}
        status={hasError ? "error" : undefined}
        allowClear={isOptional}
        onChange={(e) => onChange(arg.name, e.target.value || undefined)}
      />
    </Form.Item>
  );
};

const NodeInspector: FC<{
  node: NodeData;
  nodeDefs: NodeDefs;
  editingTree: TreeData | null;
  disabled: boolean;
}> = ({ node, nodeDefs, editingTree, disabled }) => {
  const { t } = useTranslation();
  const [data, setData] = useState<NodeData>({ ...node });

  useEffect(() => {
    setData({ ...node });
  }, [node]);

  const def = nodeDefs.get(node.name);

  const commit = useDebounceCallback((updated: NodeData) => {
    postMessage({
      type: "propertyChanged",
      nodeId: updated.id,
      data: updated as unknown as Record<string, unknown>,
    });
  }, 300);

  const update = (patch: Partial<NodeData>) => {
    const updated = { ...data, ...patch };
    setData(updated);
    commit(updated);
  };

  const updateArg = (key: string, value: unknown) => {
    const args = { ...(data.args ?? {}), [key]: value };
    update({ args });
  };

  const varOptions = editingTree
    ? [...(editingTree.vars ?? [])].map((v) => ({ value: v.name, label: v.name }))
    : [];

  return (
    <div style={{ padding: "8px" }}>
      {/* Node meta */}
      <Divider orientation="left" plain style={{ margin: "4px 0 8px" }}>
        {t("node.args")}
      </Divider>

      <Form size="small" layout="vertical" labelCol={{ style: { paddingBottom: 0 } }}>
        <Form.Item label={t("node.id")} style={{ marginBottom: 4 }}>
          <Text type="secondary">{node.id}</Text>
        </Form.Item>

        <Form.Item label={t("node.name")} style={{ marginBottom: 4 }}>
          <Text strong>{node.name}</Text>
        </Form.Item>

        <Form.Item label={t("node.desc")} style={{ marginBottom: 4 }}>
          <Input.TextArea
            disabled={disabled}
            value={data.desc ?? ""}
            autoSize={{ minRows: 1, maxRows: 3 }}
            onChange={(e) => update({ desc: e.target.value || undefined })}
          />
        </Form.Item>

        <Form.Item label={t("node.debug")} style={{ marginBottom: 4 }}>
          <Switch
            disabled={disabled}
            checked={!!data.debug}
            onChange={(v) => update({ debug: v || undefined })}
          />
        </Form.Item>

        <Form.Item label={t("node.disabled")} style={{ marginBottom: 4 }}>
          <Switch
            disabled={disabled}
            checked={!!data.disabled}
            onChange={(v) => update({ disabled: v || undefined })}
          />
        </Form.Item>

        {/* Input variables */}
        {def.input && def.input.length > 0 && (
          <>
            <Divider orientation="left" plain style={{ margin: "4px 0 8px" }}>
              {t("node.inputVariable")}
            </Divider>
            {def.input.map((inputDef, i) => {
              const isOptional = inputDef.includes("?");
              return (
                <Form.Item key={i} label={inputDef} style={{ marginBottom: 4 }}>
                  <AutoComplete
                    disabled={disabled}
                    value={data.input?.[i] ?? ""}
                    options={varOptions}
                    filterOption={(input, opt) =>
                      opt?.value.toLowerCase().includes(input.toLowerCase()) ?? true
                    }
                    allowClear={isOptional}
                    onChange={(v) => {
                      const input = [...(data.input ?? [])];
                      input[i] = v;
                      update({ input });
                    }}
                  />
                </Form.Item>
              );
            })}
          </>
        )}

        {/* Output variables */}
        {def.output && def.output.length > 0 && (
          <>
            <Divider orientation="left" plain style={{ margin: "4px 0 8px" }}>
              {t("node.outputVariable")}
            </Divider>
            {def.output.map((outputDef, i) => {
              const isOptional = outputDef.includes("?");
              return (
                <Form.Item key={i} label={outputDef} style={{ marginBottom: 4 }}>
                  <AutoComplete
                    disabled={disabled}
                    value={data.output?.[i] ?? ""}
                    options={varOptions}
                    filterOption={(input, opt) =>
                      opt?.value.toLowerCase().includes(input.toLowerCase()) ?? true
                    }
                    allowClear={isOptional}
                    onChange={(v) => {
                      const output = [...(data.output ?? [])];
                      output[i] = v;
                      update({ output });
                    }}
                  />
                </Form.Item>
              );
            })}
          </>
        )}

        {/* Args */}
        {def.args && def.args.length > 0 && (
          <>
            <Divider orientation="left" plain style={{ margin: "4px 0 8px" }}>
              {t("node.args")}
            </Divider>
            {def.args.map((arg) => (
              <ArgField
                key={arg.name}
                arg={arg as NodeArg}
                nodeData={data}
                disabled={disabled}
                onChange={updateArg}
              />
            ))}
          </>
        )}

        {/* Subtree path */}
        {node.path && (
          <>
            <Divider orientation="left" plain style={{ margin: "4px 0 8px" }}>
              {t("node.subtree")}
            </Divider>
            <Form.Item label={t("node.subtree")} style={{ marginBottom: 4 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>{node.path}</Text>
            </Form.Item>
          </>
        )}

        {/* Node definition doc */}
        {def.doc && (
          <>
            <Divider orientation="left" plain style={{ margin: "4px 0 8px" }}>
              {t("nodeDefinition")}
            </Divider>
            <div style={{ fontSize: 12, color: "#8b949e" }}>
              <Markdown>{def.doc}</Markdown>
            </div>
          </>
        )}
      </Form>
    </div>
  );
};

// ─── Tree Inspector ───────────────────────────────────────────────────────────

const TreeInspector: FC<{ tree: TreeData; nodeDefs: NodeDefs }> = ({ tree, nodeDefs }) => {
  const { t } = useTranslation();
  const [data, setData] = useState<Partial<TreeData>>({ ...tree });

  useEffect(() => {
    setData({ ...tree });
  }, [tree]);

  const commit = useDebounceCallback((updated: Partial<TreeData>) => {
    postMessage({
      type: "treePropertyChanged",
      data: updated as Record<string, unknown>,
    });
  }, 300);

  const update = (patch: Partial<TreeData>) => {
    const updated = { ...data, ...patch };
    setData(updated);
    commit(updated);
  };

  const groupOptions = Array.from(nodeDefs.keys())
    .reduce<string[]>((acc, key) => {
      const def = nodeDefs.get(key) as NodeDef & { group?: string[] };
      def.group?.forEach((g) => {
        if (!acc.includes(g)) acc.push(g);
      });
      return acc;
    }, [])
    .map((g) => ({ label: g, value: g }));

  return (
    <div style={{ padding: "8px" }}>
      <Form size="small" layout="vertical" labelCol={{ style: { paddingBottom: 0 } }}>
        <Divider orientation="left" plain style={{ margin: "4px 0 8px" }}>
          {t("tree.overview")}
        </Divider>

        <Form.Item label={t("tree.name")} style={{ marginBottom: 4 }}>
          <Input
            value={data.name ?? ""}
            onChange={(e) => update({ name: e.target.value })}
          />
        </Form.Item>

        <Form.Item label={t("tree.desc")} style={{ marginBottom: 4 }}>
          <Input.TextArea
            value={data.desc ?? ""}
            autoSize={{ minRows: 1, maxRows: 3 }}
            onChange={(e) => update({ desc: e.target.value || undefined })}
          />
        </Form.Item>

        <Form.Item label={t("tree.export")} style={{ marginBottom: 4 }}>
          <Switch
            checked={data.export !== false}
            onChange={(v) => update({ export: v })}
          />
        </Form.Item>

        <Form.Item label={t("tree.prefix")} style={{ marginBottom: 4 }}>
          <Input
            value={data.prefix ?? ""}
            onChange={(e) => update({ prefix: e.target.value || undefined })}
          />
        </Form.Item>

        {groupOptions.length > 0 && (
          <Form.Item label={t("tree.group")} style={{ marginBottom: 4 }}>
            <Select
              mode="multiple"
              value={data.group ?? []}
              options={groupOptions}
              onChange={(v) => update({ group: v })}
            />
          </Form.Item>
        )}

        {/* Variables */}
        <Divider orientation="left" plain style={{ margin: "4px 0 8px" }}>
          {t("tree.vars")}
        </Divider>

        {(data.vars ?? []).map((v, i) => (
          <Flex key={i} gap={4} align="center" style={{ marginBottom: 4 }}>
            <Input
              placeholder={t("tree.vars.name")}
              value={v.name}
              onChange={(e) => {
                const vars = [...(data.vars ?? [])];
                vars[i] = { ...vars[i], name: e.target.value };
                update({ vars });
              }}
            />
            <Input
              placeholder={t("tree.vars.desc")}
              value={v.desc}
              onChange={(e) => {
                const vars = [...(data.vars ?? [])];
                vars[i] = { ...vars[i], desc: e.target.value };
                update({ vars });
              }}
            />
            <MinusCircleOutlined
              onClick={() => {
                const vars = (data.vars ?? []).filter((_, j) => j !== i);
                update({ vars });
              }}
            />
          </Flex>
        ))}
        <Button
          size="small"
          icon={<PlusOutlined />}
          onClick={() => update({ vars: [...(data.vars ?? []), { name: "", desc: "" }] })}
          style={{ marginBottom: 8 }}
        >
          {t("add")}
        </Button>

        {/* Import paths */}
        <Divider orientation="left" plain style={{ margin: "4px 0 8px" }}>
          {t("tree.vars.imports")}
        </Divider>
        {(data.import ?? []).map((imp, i) => (
          <Flex key={i} gap={4} align="center" style={{ marginBottom: 4 }}>
            <Input
              value={imp}
              onChange={(e) => {
                const imports = [...(data.import ?? [])];
                imports[i] = e.target.value;
                update({ import: imports });
              }}
            />
            <MinusCircleOutlined
              onClick={() => {
                const imports = (data.import ?? []).filter((_, j) => j !== i);
                update({ import: imports });
              }}
            />
          </Flex>
        ))}
        <Button
          size="small"
          icon={<PlusOutlined />}
          onClick={() => update({ import: [...(data.import ?? []), ""] })}
        >
          {t("add")}
        </Button>
      </Form>
    </div>
  );
};

// ─── Main Inspector Component ─────────────────────────────────────────────────

export const Inspector: FC<{ state: InspectorState }> = ({ state }) => {
  const { t } = useTranslation();

  if (state.kind === "empty") {
    return (
      <div
        style={{
          padding: 16,
          color: "#666",
          fontSize: 13,
          textAlign: "center",
          marginTop: 40,
        }}
      >
        {t("node.noNodeSelected")}
      </div>
    );
  }

  const rawDefs = state.nodeDefs as NodeDef[];
  const nodeDefs = new NodeDefs();
  rawDefs.forEach((d) => nodeDefs.set(d.name, d));

  if (state.kind === "node" && state.node) {
    return (
      <NodeInspector
        node={state.node as NodeData}
        nodeDefs={nodeDefs}
        editingTree={state.editingTree as TreeData | null}
        disabled={false}
      />
    );
  }

  if (state.kind === "tree" && state.tree) {
    return <TreeInspector tree={state.tree as TreeData} nodeDefs={nodeDefs} />;
  }

  return null;
};
