/**
 * Shared message protocol types between Extension Host and Webview.
 */

import type { NodeDef } from "./misc/b3type";
import type {
    DocumentMutation,
    DocumentMutationSelection,
    EditNode,
    HostDocumentSnapshot,
    HostDocumentSessionState,
    NodeCheckValidationNode,
} from "./contracts";

export type { NodeDef };

export type EditorToHostMessage =
    | { type: "ready" }
    | { type: "undo" }
    | { type: "redo" }
    /** Ask the active editor webview to highlight nodes that use these variables. */
    | { type: "focusVariable"; names: string[] }
    | { type: "mutateDocument"; requestId: string; mutation: DocumentMutation }
    | { type: "saveDocument"; requestId: string }
    | { type: "revertDocument"; requestId: string }
    | { type: "requestSetting" }
    | { type: "build"; buildScriptDebug?: boolean }
    | {
          type: "validateNodeChecks";
          requestId: string;
          content: string;
          treePath: string;
          nodes: NodeCheckValidationNode[];
      }
    | { type: "readFile"; requestId: string; path: string; openIfSubtree?: boolean }
    | { type: "saveSubtree"; requestId: string; path: string; content: string }
    /** Right-click -> Save as subtree: pick path under workdir and write JSON from webview. */
    | { type: "saveSubtreeAs"; requestId: string; content: string; suggestedBaseName: string }
    /** Mirror the current editor inspector selection to extension-host side views. */
    | { type: "reportInspectorSelection"; selectedNode: EditNode | null }
    /** Forward webview `console.*` to extension Output panel. */
    | { type: "webviewLog"; level: "log" | "info" | "warn" | "error" | "debug"; message: string };

export type HostToEditorMessage =
    | {
          type: "init";
          content: string;
          filePath: string;
          workdir: string;
          nodeDefs: NodeDef[];
          checkExpr: boolean;
          subtreeEditable: boolean;
          language: "zh" | "en";
          theme: "dark" | "light";
          allFiles: string[];
          nodeColors?: Record<string, string>;
          documentSession: HostDocumentSessionState;
      }
    | { type: "documentSnapshotChanged"; snapshot: HostDocumentSnapshot }
    /** Cross-webview variable focus sync from the sidebar inspector into the active editor. */
    | { type: "focusVariable"; names: string[] }
    /** A referenced subtree file was saved or edited; parent canvas should reload subtree data. */
    | { type: "subtreeFileChanged" }
    /** Sidebar inspector selection sync for the active editor session. */
    | { type: "inspectorSelectionChanged"; selectedNode: EditNode | null }
    /** No active Behavior3 editor is currently driving the sidebar inspector. */
    | { type: "inspectorContextCleared" }
    | {
          type: "settingLoaded";
          nodeDefs: NodeDef[];
          settings?: {
              checkExpr?: boolean;
              subtreeEditable?: boolean;
              language?: "zh" | "en";
              nodeColors?: Record<string, string>;
          };
      }
    | { type: "buildResult"; success: boolean; message: string }
    | {
          type: "validateNodeChecksResult";
          requestId: string;
          diagnostics: Array<{
              instanceKey: string;
              argName: string;
              checker: string;
              message: string;
          }>;
          error?: string;
      }
    | { type: "readFileResult"; requestId: string; content: string | null }
    | {
          type: "saveSubtreeResult";
          requestId: string;
          success: boolean;
          error?: string;
      }
    | {
          type: "saveSubtreeAsResult";
          requestId: string;
          savedPath: string | null;
          error?: string;
      }
    | {
          type: "saveDocumentResult";
          requestId: string;
          success: boolean;
          error?: string;
      }
    | {
          type: "mutateDocumentResult";
          requestId: string;
          success: boolean;
          error?: string;
          nextSelection?: DocumentMutationSelection;
      }
    | {
          type: "revertDocumentResult";
          requestId: string;
          success: boolean;
          error?: string;
      }
    | {
          type: "varDeclLoaded";
          usingVars: Array<{ name: string; desc: string }>;
          allFiles?: string[];
          importDecls?: Array<{ path: string; vars: Array<{ name: string; desc: string }> }>;
          subtreeDecls?: Array<{ path: string; vars: Array<{ name: string; desc: string }> }>;
      }
    | { type: "themeChanged"; theme: "dark" | "light" };
