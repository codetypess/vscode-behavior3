import { App as AntdApp, ConfigProvider, Flex, Layout, Typography } from "antd";
import React, { useEffect, useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import { getAntdLocale } from "../shared/misc/antd-locale";
import i18n, { setI18nLanguage } from "../shared/misc/i18n";
import { getThemeConfig } from "../shared/misc/theme";
import { GraphPane } from "../features/graph/graph-pane";
import { applyDocumentTheme } from "../shared/theme-mode";
import type { HostEvent } from "../shared/contracts";
import { applyWorkspaceTheme, mergeWorkspaceSettings } from "../stores/workspace-store";
import { GlobalHooksBridge } from "./global-hooks-bridge";
import { useAppShellState, useAppThemeState, useRuntime } from "./runtime";

const { Content } = Layout;

const AppShell: React.FC = () => {
    const runtime = useRuntime();
    const { message: messageApi } = AntdApp.useApp();
    const { t } = useTranslation();
    const { theme, language, hasDocument } = useAppShellState();

    useEffect(() => {
        const applyThemeChange = (theme: "dark" | "light") => {
            applyWorkspaceTheme(runtime.workspaceStore, theme);
        };

        const handleBuildResult = (event: Extract<HostEvent, { type: "buildResult" }>) => {
            const text =
                event.message.trim() || i18n.t(event.success ? "build.success" : "build.failed");
            void (event.success ? messageApi.success(text) : messageApi.error(text));
            runtime.hostAdapter.log(
                event.success ? "info" : "warn",
                `[v2] build result: ${event.message}`
            );
        };

        const handleHostMessage = (hostEvent: HostEvent) => {
            switch (hostEvent.type) {
                case "init":
                    void (async () => {
                        await setI18nLanguage(hostEvent.payload.settings.language);
                        await runtime.controller.initFromHost(hostEvent.payload);
                    })();
                    return;

                case "documentSnapshotChanged":
                    void runtime.controller.applyDocumentSnapshot(hostEvent.snapshot);
                    return;

                case "focusVariable":
                    void runtime.controller.focusVariable(hostEvent.names);
                    return;

                case "themeChanged":
                    applyThemeChange(hostEvent.theme);
                    void runtime.controller.refreshGraph({ preserveSelection: true });
                    return;

                case "settingLoaded":
                    void (async () => {
                        if (hostEvent.settings?.language) {
                            await setI18nLanguage(hostEvent.settings.language);
                        }

                        mergeWorkspaceSettings(runtime.workspaceStore, hostEvent.settings ?? {});
                        await runtime.controller.applyNodeDefs(hostEvent.nodeDefs);
                    })();
                    return;

                case "varDeclLoaded":
                    void runtime.controller.applyHostVars(hostEvent.payload);
                    return;

                case "subtreeFileChanged":
                    void runtime.controller.markSubtreeChanged();
                    return;

                case "inspectorContextCleared":
                    return;

                case "buildResult":
                    handleBuildResult(hostEvent);
                    return;
            }
        };

        const off = runtime.hostAdapter.connect(handleHostMessage);

        runtime.hostAdapter.sendReady();
        return off;
    }, [messageApi, runtime]);

    useLayoutEffect(() => {
        applyDocumentTheme(theme);
    }, [theme]);

    useEffect(() => {
        void setI18nLanguage(language);
    }, [language]);

    return (
        <Layout className="b3-shell">
            <Layout className="b3-body">
                <Content className="b3-content">
                    {hasDocument ? (
                        <GraphPane />
                    ) : (
                        <Flex className="b3-loading" justify="center" align="center">
                            <Typography.Text type="secondary">
                                {t("editor.loading")}
                            </Typography.Text>
                        </Flex>
                    )}
                </Content>
            </Layout>
        </Layout>
    );
};

export const App: React.FC = () => {
    const { theme, language, themeVersion, webviewKind } = useAppThemeState();

    return (
        <ConfigProvider
            locale={getAntdLocale(language)}
            theme={getThemeConfig(theme, themeVersion, webviewKind)}
        >
            <AntdApp style={{ height: "100%" }}>
                <GlobalHooksBridge />
                <AppShell />
            </AntdApp>
        </ConfigProvider>
    );
};
