import { Alert, Button, Flex, Skeleton, Tooltip, Typography } from "antd";
import React from "react";
import { useTranslation } from "react-i18next";
import { useRuntime, useWorkspaceStore } from "../../app/runtime";
import type { InspectorHostCommandId } from "../../shared/contracts";
import { getInspectorPaneMode } from "./inspector-pane-mode";
import { NodeInspectorForm } from "./node-inspector-form";
import { useInspectorPaneState } from "./inspector-state";
import { TreeInspectorForm } from "./tree-inspector-form";

const InspectorSkeletonRow: React.FC = () => {
    return (
        <div className="b3-inspector-skeleton-row">
            <Skeleton.Input active size="small" className="b3-inspector-skeleton-label" />
            <Skeleton.Input active size="small" block className="b3-inspector-skeleton-field" />
        </div>
    );
};

const InspectorSkeleton: React.FC = () => {
    return (
        <div className="b3-inspector b3-inspector-skeleton">
            <InspectorSkeletonContent />
        </div>
    );
};

const InspectorSkeletonContent: React.FC = () => {
    return (
        <>
            <div className="b3-inspector-header">
                <Skeleton.Input active size="small" className="b3-inspector-skeleton-title" />
            </div>
            <div className="b3-inspector-content b3-inspector-skeleton-content">
                <InspectorSkeletonRow />
                <InspectorSkeletonRow />
                <InspectorSkeletonRow />
                <Skeleton.Input active size="small" className="b3-inspector-skeleton-section" />
                <InspectorSkeletonRow />
                <InspectorSkeletonRow />
            </div>
        </>
    );
};

const InspectorReloadBanner: React.FC<{
    pendingExternalContent: string | null;
    onReload: () => void;
    onDismiss: () => void;
}> = ({ pendingExternalContent, onReload, onDismiss }) => {
    const { t } = useTranslation();

    return (
        <Alert
            type="warning"
            showIcon
            title={t("editor.externalChangeConflict")}
            className="b3-inspector-banner"
            action={
                <Flex gap={8}>
                    <Button
                        size="small"
                        type="primary"
                        disabled={!pendingExternalContent}
                        onClick={onReload}
                    >
                        {t("editor.reloadFromDisk")}
                    </Button>
                    <Button size="small" onClick={onDismiss}>
                        {t("editor.dismissConflict")}
                    </Button>
                </Flex>
            }
        />
    );
};

const EMBEDDED_INSPECTOR_ACTIONS: Array<{
    command: InspectorHostCommandId;
    titleKey: string;
    codicon: string;
}> = [
    {
        command: "behavior3.build",
        titleKey: "inspector.embeddedToolbar.build",
        codicon: "build",
    },
    {
        command: "behavior3.toggleEditorMode",
        titleKey: "inspector.embeddedToolbar.toggleEditorMode",
        codicon: "edit-code",
    },
    {
        command: "behavior3.toggleInspectorNodeJson",
        titleKey: "inspector.embeddedToolbar.toggleInspectorNodeJson",
        codicon: "code",
    },
    {
        command: "behavior3.createProject",
        titleKey: "inspector.embeddedToolbar.createProject",
        codicon: "new-folder",
    },
    {
        command: "behavior3.createTree",
        titleKey: "inspector.embeddedToolbar.createTree",
        codicon: "new-file",
    },
];

const EmbeddedInspectorHeader: React.FC = () => {
    const runtime = useRuntime();
    const { t } = useTranslation();

    return (
        <div className="b3-inspector-header b3-inspector-header-embedded">
            <div className="b3-inspector-header-row b3-inspector-header-toolbar-row">
                <Typography.Text className="b3-inspector-header-title">BEHAVIOR3</Typography.Text>
                <Flex align="center" gap={2} className="b3-inspector-toolbar-actions">
                    {EMBEDDED_INSPECTOR_ACTIONS.map((action) => (
                        <Tooltip key={action.command} title={t(action.titleKey)}>
                            <Button
                                type="text"
                                size="small"
                                className="b3-inspector-toolbar-button"
                                icon={
                                    <span
                                        className={`codicon codicon-${action.codicon} b3-inspector-toolbar-codicon`}
                                        aria-hidden="true"
                                    />
                                }
                                aria-label={t(action.titleKey)}
                                onClick={() =>
                                    runtime.hostAdapter.executeInspectorHostCommand(action.command)
                                }
                            />
                        </Tooltip>
                    ))}
                </Flex>
            </div>
        </div>
    );
};

export const InspectorPane: React.FC = () => {
    const runtime = useRuntime();
    const { document, alertReload, pendingExternalContent, selectedNode, selectedNodeRef } =
        useInspectorPaneState();
    const inspectorMode = useWorkspaceStore((state) => state.settings.inspectorMode);
    const paneMode = getInspectorPaneMode({
        documentPresent: Boolean(document),
        selectedNode,
        selectedNodeRef,
    });

    if (paneMode === "skeleton") {
        return <InspectorSkeleton />;
    }

    return (
        <div className="b3-inspector">
            {inspectorMode === "embedded" ? <EmbeddedInspectorHeader /> : null}

            {alertReload ? (
                <InspectorReloadBanner
                    pendingExternalContent={pendingExternalContent}
                    onReload={() => void runtime.controller.revertDocument()}
                    onDismiss={() => void runtime.controller.dismissReloadConflict()}
                />
            ) : null}

            {paneMode === "node" ? <NodeInspectorForm /> : null}
            {paneMode === "node-pending" ? (
                <div className="b3-inspector-skeleton">
                    <InspectorSkeletonContent />
                </div>
            ) : null}
            {paneMode === "tree" ? <TreeInspectorForm /> : null}
        </div>
    );
};
