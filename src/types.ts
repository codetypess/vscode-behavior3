/**
 * Shared message protocol types between Extension Host and Webview.
 */

export interface NodeDef {
  name: string;
  type: string;
  desc?: string;
  doc?: string;
  args?: Array<{
    name: string;
    type: string;
    desc?: string;
    default?: unknown;
    options?: unknown;
    optional?: boolean;
  }>;
  input?: string[];
  output?: string[];
  children?: number;
}

// ─── Editor Webview → Extension Host ────────────────────────────────────────

export type EditorToHostMessage =
  | { type: "ready" }
  | { type: "update"; content: string }
  | { type: "treeSelected"; tree: unknown }
  | { type: "requestSetting" }
  | { type: "build" }
  | { type: "readFile"; requestId: string; path: string }
  | { type: "saveSubtree"; requestId: string; path: string; content: string };

// ─── Extension Host → Editor Webview ────────────────────────────────────────

export type HostToEditorMessage =
  | {
      type: "init";
      content: string;
      filePath: string;
      workdir: string;
      nodeDefs: NodeDef[];
      checkExpr: boolean;
      theme: "dark" | "light";
      allFiles: string[];
    }
  | { type: "fileChanged"; content: string }
  | { type: "settingLoaded"; nodeDefs: NodeDef[] }
  | { type: "buildResult"; success: boolean; message: string }
  | { type: "readFileResult"; requestId: string; content: string | null }
  | {
      type: "varDeclLoaded";
      usingVars: Array<{ name: string; desc: string }>;
      allFiles?: string[];
      importDecls?: Array<{ path: string; vars: Array<{ name: string; desc: string }> }>;
      subtreeDecls?: Array<{ path: string; vars: Array<{ name: string; desc: string }> }>;
    };
