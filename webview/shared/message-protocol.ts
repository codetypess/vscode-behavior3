/**
 * Shared message protocol types between Extension Host and Webview.
 */

import type { NodeDef } from "./misc/b3type";
import type {
    DocumentMutation,
    HostDocumentSnapshot,
    HostDocumentSessionState,
    HostSelectionState,
    NodeCheckDiagnostic,
    NodeCheckValidationNode,
    NodeInstanceRef,
} from "./contracts";

export type { NodeDef };

export type EditorToHostMessage =
    | { type: "ready" }
    | { type: "undo" }
    | { type: "redo" }
    | { type: "selectTree" }
    | { type: "selectNode"; target: NodeInstanceRef }
    /** Ask the host to relay a one-shot variable highlight intent to the active editor. */
    | { type: "requestFocusVariable"; names: string[] }
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
    | {
          type: "readFile";
          requestId: string;
          path: string;
          openIfSubtree?: boolean;
          openSelection?: NodeInstanceRef;
      }
    | { type: "saveSubtree"; requestId: string; path: string; content: string }
    /** Right-click -> Save as subtree: pick path under workdir and write JSON from webview. */
    | { type: "saveSubtreeAs"; requestId: string; content: string; suggestedBaseName: string }
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
          selection: HostSelectionState;
      }
    | { type: "documentSnapshotChanged"; snapshot: HostDocumentSnapshot }
    /** One-shot variable highlight relay into the active editor; not snapshot authority. */
    | { type: "relayFocusVariable"; names: string[] }
    /** One-shot node reveal relay into the active editor; selection authority still comes from snapshots. */
    | { type: "relayFocusNode"; target: NodeInstanceRef }
    /** A referenced subtree file was saved or edited; parent canvas should reload subtree data. */
    | { type: "subtreeFileChanged" }
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
          diagnostics: NodeCheckDiagnostic[];
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
