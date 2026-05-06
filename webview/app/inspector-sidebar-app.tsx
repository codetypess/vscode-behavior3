import { App as AntdApp, ConfigProvider, Flex, Typography } from "antd";
import React, { useEffect, useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import { getAntdLocale } from "../shared/misc/antd-locale";
import { deriveGroupDefs } from "../shared/protocol";
import { parsePersistedTreeContent, serializePersistedTree } from "../shared/tree";
import { applyDocumentTheme } from "../shared/theme-mode";
import { getThemeConfig } from "../shared/misc/theme";
import { setI18nLanguage } from "../shared/misc/i18n";
import { isMacos } from "../shared/misc/keys";
import type { EditNode, HostEvent, HostInitPayload, HostVarsPayload } from "../shared/contracts";
import { createInitialDocumentState } from "../stores/document-store";
import { createInitialSelectionState } from "../stores/selection-store";
import { createInitialWorkspaceState } from "../stores/workspace-store";
import { buildUsingGroups } from "../commands/controller-runtime";
import { InspectorPane } from "../features/inspector/inspector-pane";
import { InspectorModeProvider } from "../features/inspector/inspector-mode";
import { flushPendingInspectorEdits } from "../features/inspector/inspector-shared";
import {
    RuntimeProvider,
    createEditorRuntime,
    useAppThemeState,
    useDocumentStore,
    useRuntime,
    useWorkspaceStore,
} from "./runtime";
import { GlobalHooksBridge } from "./global-hooks-bridge";

const resetSidebarContext = (runtime: ReturnType<typeof createEditorRuntime>) => {
    runtime.documentStore.setState(() => createInitialDocumentState());
    runtime.selectionStore.setState(() => createInitialSelectionState());
    runtime.workspaceStore.setState((state) => ({
        ...createInitialWorkspaceState(),
        settings: state.settings,
        themeVersion: state.themeVersion,
    }));
};

const blurActiveSidebarElement = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) {
        active.blur();
    }
};

const applySidebarInit = async (
    runtime: ReturnType<typeof createEditorRuntime>,
    payload: HostInitPayload
) => {
    await setI18nLanguage(payload.settings.language);
    const persistedTree = parsePersistedTreeContent(payload.content, payload.filePath);
    const snapshot = serializePersistedTree(persistedTree);
    runtime.documentStore.setState((state) => ({
        ...state,
        persistedTree,
        dirty: false,
        alertReload: false,
        pendingExternalContent: null,
        history: [snapshot],
        historyIndex: 0,
        lastSavedSnapshot: snapshot,
    }));
    runtime.workspaceStore.setState((state) => ({
        ...state,
        filePath: payload.filePath,
        workdir: payload.workdir,
        nodeDefs: payload.nodeDefs,
        groupDefs: deriveGroupDefs(payload.nodeDefs),
        allFiles: payload.allFiles,
        settings: payload.settings,
        usingGroups: buildUsingGroups(persistedTree.group),
    }));
    runtime.selectionStore.setState((state) => ({
        ...state,
        ...createInitialSelectionState(),
        selectedTree: payload.filePath ? { filePath: payload.filePath } : null,
    }));

    await runtime.controller.refreshGraph({ preserveSelection: false });
};

const applySidebarVars = (
    runtime: ReturnType<typeof createEditorRuntime>,
    payload: HostVarsPayload
) => {
    runtime.workspaceStore.setState((state) => ({
        ...state,
        usingVars: payload.usingVars,
        allFiles: payload.allFiles ?? state.allFiles,
        importDecls: payload.importDecls,
        subtreeDecls: payload.subtreeDecls,
    }));
};

const applySidebarSelection = (
    runtime: ReturnType<typeof createEditorRuntime>,
    selectedNode: EditNode | null
) => {
    blurActiveSidebarElement();

    const filePath = runtime.workspaceStore.getState().filePath;
    runtime.selectionStore.setState((state) => ({
        ...state,
        selectedTree: selectedNode ? null : filePath ? { filePath } : null,
        selectedNodeKey: selectedNode?.ref.instanceKey ?? null,
        selectedNodeRef: selectedNode?.ref ?? null,
        selectedNodeSnapshot: selectedNode,
        selectedNodeDef: null,
        activeVariableNames: [],
    }));

    window.setTimeout(() => {
        blurActiveSidebarElement();
        window.setTimeout(() => {
            blurActiveSidebarElement();
        }, 0);
    }, 0);
};

const isEditableTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable ||
        Boolean(target.closest(".ant-select-dropdown")) ||
        Boolean(target.closest(".ant-picker-dropdown"))
    );
};

const SidebarHostBridge: React.FC = () => {
    const runtime = useRuntime();

    useEffect(() => {
        const handleHostMessage = (hostEvent: HostEvent) => {
            switch (hostEvent.type) {
                case "init":
                    void applySidebarInit(runtime, hostEvent.payload);
                    return;

                case "documentUpdated":
                    void runtime.controller.syncDocumentFromHost(hostEvent.content);
                    return;

                case "documentReloaded":
                    void runtime.controller.reloadDocumentFromHost(hostEvent.content, {
                        force: true,
                    });
                    return;

                case "varDeclLoaded":
                    applySidebarVars(runtime, hostEvent.payload);
                    return;

                case "settingLoaded":
                    void (async () => {
                        if (hostEvent.settings?.language) {
                            await setI18nLanguage(hostEvent.settings.language);
                        }
                        runtime.workspaceStore.setState((state) => ({
                            ...state,
                            nodeDefs: hostEvent.nodeDefs,
                            groupDefs: deriveGroupDefs(hostEvent.nodeDefs),
                            settings: {
                                ...state.settings,
                                ...hostEvent.settings,
                            },
                        }));
                    })();
                    return;

                case "themeChanged":
                    runtime.workspaceStore.setState((state) => ({
                        ...state,
                        settings: {
                            ...state.settings,
                            theme: hostEvent.theme,
                        },
                        themeVersion: state.themeVersion + 1,
                    }));
                    return;

                case "inspectorSelectionChanged":
                    applySidebarSelection(runtime, hostEvent.selectedNode);
                    return;

                case "inspectorContextCleared":
                    resetSidebarContext(runtime);
                    return;

                case "executeDocumentMutation":
                case "fileChanged":
                case "subtreeFileChanged":
                case "buildResult":
                    return;
            }
        };

        const off = runtime.hostAdapter.connect(handleHostMessage);
        runtime.hostAdapter.sendReady();
        return off;
    }, [runtime]);

    return null;
};

const SidebarShell: React.FC = () => {
    const runtime = useRuntime();
    const { t } = useTranslation();
    const theme = useWorkspaceStore((state) => state.settings.theme);
    const hasDocument = useDocumentStore((state) => state.persistedTree !== null);

    useLayoutEffect(() => {
        applyDocumentTheme(theme);
    }, [theme]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || !hasDocument || event.isComposing) {
                return;
            }

            if ((event.metaKey || event.ctrlKey) && !event.altKey && event.code === "KeyS") {
                event.preventDefault();
                event.stopPropagation();
                void (async () => {
                    await flushPendingInspectorEdits();
                    await runtime.controller.saveDocument();
                })();
                return;
            }

            const undoPressed =
                (event.metaKey || event.ctrlKey) &&
                !event.altKey &&
                !event.shiftKey &&
                event.code === "KeyZ";
            const redoPressed =
                (event.metaKey || event.ctrlKey) &&
                !event.altKey &&
                ((isMacos && event.shiftKey && event.code === "KeyZ") ||
                    (!isMacos && !event.shiftKey && event.code === "KeyY"));

            if (!undoPressed && !redoPressed) {
                return;
            }

            if (isEditableTarget(event.target)) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            void (async () => {
                await flushPendingInspectorEdits();
                if (undoPressed) {
                    runtime.hostAdapter.undo();
                } else {
                    runtime.hostAdapter.redo();
                }
            })();
        };

        window.addEventListener("keydown", handleKeyDown, true);
        return () => {
            window.removeEventListener("keydown", handleKeyDown, true);
        };
    }, [hasDocument, runtime]);

    return hasDocument ? (
        <InspectorModeProvider>
            <InspectorPane />
        </InspectorModeProvider>
    ) : (
        <Flex className="b3-inspector-empty" justify="center" align="center">
            <Typography.Text type="secondary">{t("inspector.noActiveDocument")}</Typography.Text>
        </Flex>
    );
};

const SidebarAppFrame: React.FC = () => {
    const { theme, language, themeVersion } = useAppThemeState();

    return (
        <ConfigProvider
            locale={getAntdLocale(language)}
            theme={getThemeConfig(theme, themeVersion)}
        >
            <AntdApp style={{ height: "100%" }}>
                <GlobalHooksBridge />
                <SidebarHostBridge />
                <SidebarShell />
            </AntdApp>
        </ConfigProvider>
    );
};

const runtime = createEditorRuntime();

export const InspectorSidebarApp: React.FC = () => {
    return (
        <React.StrictMode>
            <RuntimeProvider runtime={runtime}>
                <SidebarAppFrame />
            </RuntimeProvider>
        </React.StrictMode>
    );
};
