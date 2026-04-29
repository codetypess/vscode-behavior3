import { Alert, Empty } from "antd";
import React from "react";
import { useDocumentStore, useSelectionStore } from "../../app/runtime";
import { NodeInspectorForm } from "./node-inspector-form";
import { TreeInspectorForm } from "./tree-inspector-form";

export const InspectorPane: React.FC = () => {
    const document = useDocumentStore((state) => state.persistedTree);
    const alertReload = useDocumentStore((state) => state.alertReload);
    const selectedNode = useSelectionStore((state) => state.selectedNodeSnapshot);

    if (!document) {
        return (
            <div className="b3-v2-inspector">
                <Empty description="Waiting for host init" />
            </div>
        );
    }

    return (
        <div className="b3-v2-inspector">
            {alertReload ? (
                <Alert
                    type="warning"
                    showIcon
                    title="External file change detected while document is dirty"
                    className="b3-v2-inspector-banner"
                />
            ) : null}

            {selectedNode ? <NodeInspectorForm /> : <TreeInspectorForm />}
        </div>
    );
};
