// Adapted from original: removed fs/path Node.js imports (browser-safe version)
import { customAlphabet } from "nanoid";
import { VERSION, type TreeData } from "./b3type";
import { createNode, dfs } from "./b3util";
import { stringifyJson } from "./stringify";

export const nanoid = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
  10
);

export const parseJson = <T>(text: string): T => {
  return JSON.parse(text) as T;
};

/**
 * 与原版 `writeTree` 写入磁盘的对象结构一致（version/name/root(createNode)/…），供 postMessage 等传对象用。
 */
export const treeDataForPersistence = (data: TreeData, name: string): TreeData => {
  return {
    version: VERSION,
    name,
    desc: data.desc,
    prefix: data.prefix,
    export: data.export,
    group: data.group,
    import: data.import,
    vars: data.vars,
    root: createNode(data.root),
    custom: data.custom,
    $override: data.$override,
  };
};

/** 原版：writeJson(writeTree(...)) → stringifyJson，禁止 JSON.stringify 整棵 editor.data */
export const writeTree = (data: TreeData, name: string): string => {
  return stringifyJson(treeDataForPersistence(data, name), { indent: 2 });
};

export const readTree = (text: string): TreeData => {
  const data = JSON.parse(text) as TreeData;
  data.version = data.version ?? VERSION;
  data.prefix = data.prefix ?? "";
  data.group = data.group || [];
  data.import = data.import || [];
  data.vars = data.vars || [];
  data.root = data.root || {};
  data.$override = data.$override || {};
  data.custom = data.custom || {};

  dfs(data.root, (node) => {
    node.id = node.id.toString();
    if (!node.$id) {
      node.$id = nanoid();
    }
  });

  return data;
};

export function mergeClassNames(...cls: (string | boolean)[]): string {
  return cls.filter((v) => !!v).join(" ");
}

/** Extract basename without extension from a file path */
export const basenameWithoutExt = (path: string): string => {
  const base = path.split(/[\\/]/).pop() ?? path;
  const dotIdx = base.lastIndexOf(".");
  return dotIdx > 0 ? base.slice(0, dotIdx) : base;
};

/** Get dirname from a file path */
export const dirname = (path: string): string => {
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(0, idx) : ".";
};

/** Join path segments (posix style) */
export const joinPath = (...parts: string[]): string => {
  return parts.join("/").replace(/\/+/g, "/");
};

/** Get relative path from base to target */
export const relativePath = (from: string, to: string): string => {
  const fromParts = from.replace(/\\/g, "/").split("/");
  const toParts = to.replace(/\\/g, "/").split("/");
  let i = 0;
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) {
    i++;
  }
  const ups = fromParts.length - i;
  const rel = [...Array(ups).fill(".."), ...toParts.slice(i)].join("/");
  return rel || ".";
};
