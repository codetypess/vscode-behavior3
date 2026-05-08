import { VERSION } from "../shared/misc/b3type";
import { compareDocumentVersion } from "../shared/document-version";
import type {
    EditorCommand,
    HostDocumentSnapshot,
    HostInitPayload,
    HostVarsPayload,
    NodeDef,
} from "../shared/contracts";
import { deriveGroupDefs } from "../shared/protocol";
import { parsePersistedTreeContent } from "../shared/tree";
import { applyHostDocumentSession, clearDocumentReloadConflict } from "../stores/document-store";
import { buildUsingGroups, isJsonEqual, type ControllerRuntime } from "./controller-runtime";

type DocumentCommandKeys =
    | "initFromHost"
    | "applyDocumentSnapshot"
    | "applyNodeDefs"
    | "applyHostVars"
    | "markSubtreeChanged"
    | "dismissReloadConflict"
    | "undo"
    | "redo"
    | "refreshGraph"
    | "saveDocument"
    | "revertDocument"
    | "buildDocument";

export const createDocumentCommands = (
    runtime: ControllerRuntime
): Pick<EditorCommand, DocumentCommandKeys> => {
    const { deps } = runtime;

    return {
        async initFromHost(payload: HostInitPayload) {
            const persistedTree = parsePersistedTreeContent(payload.content, payload.filePath);
            deps.workspaceStore.setState((state) => ({
                ...state,
                filePath: payload.filePath,
                workdir: payload.workdir,
                nodeDefs: payload.nodeDefs,
                groupDefs: deriveGroupDefs(payload.nodeDefs),
                allFiles: payload.allFiles,
                settings: payload.settings,
                usingGroups: buildUsingGroups(persistedTree.group),
            }));
            runtime.resetGraphUiState();
            runtime.applyHostSelectionState(payload.selection);

            await runtime.applyDocumentTree(persistedTree, {
                preserveSelection: true,
            });
            applyHostDocumentSession(deps.documentStore, payload.documentSession);
        },

        async applyDocumentSnapshot(snapshot: HostDocumentSnapshot) {
            applyHostDocumentSession(deps.documentStore, snapshot.documentSession);

            const matchesCurrent = runtime.matchesCurrentDocumentSnapshot(snapshot.content);
            runtime.applyHostSelectionState(snapshot.selection);
            if (!matchesCurrent && snapshot.syncKind === "reload") {
                runtime.resetGraphUiState();
            }
            if (matchesCurrent) {
                await runtime.applyVisualState();
                return;
            }

            const filePath = deps.workspaceStore.getState().filePath || undefined;
            const tree = parsePersistedTreeContent(snapshot.content, filePath);
            await runtime.applyDocumentTree(tree, {
                preserveSelection: true,
            });
        },

        async applyNodeDefs(defs: NodeDef[]) {
            deps.workspaceStore.setState((state) => ({
                ...state,
                nodeDefs: defs,
                groupDefs: deriveGroupDefs(defs),
            }));
            await runtime.rebuildGraph({ preserveSelection: true });
        },

        async applyHostVars(payload: HostVarsPayload) {
            const current = deps.workspaceStore.getState();
            const nextAllFiles = payload.allFiles ?? current.allFiles;
            const usingVarsChanged = !isJsonEqual(current.usingVars, payload.usingVars);
            const allFilesChanged = !isJsonEqual(current.allFiles, nextAllFiles);
            const importDeclsChanged = !isJsonEqual(current.importDecls, payload.importDecls);
            const subtreeDeclsChanged = !isJsonEqual(current.subtreeDecls, payload.subtreeDecls);

            if (
                !usingVarsChanged &&
                !allFilesChanged &&
                !importDeclsChanged &&
                !subtreeDeclsChanged
            ) {
                return;
            }

            deps.workspaceStore.setState((state) => ({
                ...state,
                usingVars: payload.usingVars,
                allFiles: payload.allFiles ?? state.allFiles,
                importDecls: payload.importDecls,
                subtreeDecls: payload.subtreeDecls,
            }));

            if (usingVarsChanged) {
                await runtime.rebuildGraph({ preserveSelection: true });
            }
        },

        async markSubtreeChanged() {
            await runtime.syncReachableSubtreeSources();
            await runtime.rebuildGraph({ preserveSelection: true });
        },

        async dismissReloadConflict() {
            clearDocumentReloadConflict(deps.documentStore);
        },

        async undo() {
            deps.hostAdapter.undo();
        },

        async redo() {
            deps.hostAdapter.redo();
        },

        async refreshGraph(opts?: { preserveSelection?: boolean }) {
            await runtime.rebuildGraph({
                preserveSelection: opts?.preserveSelection ?? true,
            });
        },

        async saveDocument() {
            const tree = deps.documentStore.getState().persistedTree;
            if (!tree) {
                return;
            }
            if (compareDocumentVersion(tree.version, VERSION) > 0) {
                deps.hostAdapter.log(
                    "warn",
                    `[v2] refusing to save newer file version: ${tree.version}`
                );
                return;
            }
            const response = await deps.hostAdapter.saveDocument();
            if (!response.success) {
                runtime.notifyError(response.error ?? "Save failed");
            }
        },

        async revertDocument() {
            const response = await deps.hostAdapter.revertDocument();
            if (!response.success) {
                runtime.notifyError(response.error ?? "Revert failed");
            }
        },

        async buildDocument(opts) {
            deps.hostAdapter.sendBuild(opts);
        },
    };
};
