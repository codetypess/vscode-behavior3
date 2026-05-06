import { App as AntdApp, ConfigProvider, Flex, Typography } from "antd";
import React, { useEffect, useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import { getAntdLocale } from "../shared/misc/antd-locale";
import { deriveGroupDefs } from "../shared/protocol";
import { applyDocumentTheme } from "../shared/theme-mode";
import { getThemeConfig } from "../shared/misc/theme";
import { setI18nLanguage } from "../shared/misc/i18n";
import { isMacos } from "../shared/misc/keys";
import type {
    HostEvent,
    HostInitPayload,
    HostSelectionState,
    HostVarsPayload,
} from "../shared/contracts";
import { createInitialDocumentState } from "../stores/document-store";
import { createInitialSelectionState } from "../stores/selection-store";
import { createInitialWorkspaceState } from "../stores/workspace-store";
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
    await runtime.controller.initFromHost(payload);
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

const buildCurrentHostSelection = (
    runtime: ReturnType<typeof createEditorRuntime>
): HostSelectionState => {
    const { selectedNodeRef } = runtime.selectionStore.getState();
    return selectedNodeRef ? { kind: "node", ref: selectedNodeRef } : { kind: "tree" };
};

const queueSidebarSelectionBlur = (runtime: ReturnType<typeof createEditorRuntime>) => {
    runtime.selectionStore.setState((state) => ({
        ...state,
        activeVariableNames: [],
    }));
    blurActiveSidebarElement();
    window.setTimeout(() => {
        blurActiveSidebarElement();
        window.setTimeout(() => {
            blurActiveSidebarElement();
        }, 0);
    }, 0);
};

const hasIncomingSelectionChange = (
    runtime: ReturnType<typeof createEditorRuntime>,
    selection: HostSelectionState
) => JSON.stringify(buildCurrentHostSelection(runtime)) !== JSON.stringify(selection);

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
                    void (async () => {
                        const selectionChanged = hasIncomingSelectionChange(
                            runtime,
                            hostEvent.payload.selection
                        );
                        await applySidebarInit(runtime, hostEvent.payload);
                        if (selectionChanged) {
                            queueSidebarSelectionBlur(runtime);
                        }
                    })();
                    return;

                case "documentSnapshotChanged":
                    void (async () => {
                        const selectionChanged = hasIncomingSelectionChange(
                            runtime,
                            hostEvent.snapshot.selection
                        );
                        await runtime.controller.applyDocumentSnapshot(hostEvent.snapshot);
                        if (selectionChanged) {
                            queueSidebarSelectionBlur(runtime);
                        }
                    })();
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

                case "inspectorContextCleared":
                    resetSidebarContext(runtime);
                    return;

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
                    await runtime.controller.undo();
                } else {
                    await runtime.controller.redo();
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
