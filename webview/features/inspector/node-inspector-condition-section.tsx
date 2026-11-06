import { Tooltip } from "antd";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useRuntime, useWorkspaceStore } from "../../app/runtime";
import { isConditionInvalid } from "../../domain/condition-validation";
import type { EditNode } from "../../shared/contracts";
import { createNodeDefMap, findNodeDef } from "../../shared/node-utils";
import { SectionDivider } from "./inspector-shared";
import flushIconUrl from "../../../media/icons/Flush.svg";

// The condition cards' icon. A mask lets it take the row's text color (red when invalid).
const conditionIconStyle = {
    "--b3-node-condition-icon-url": `url("${flushIconUrl}")`,
} as React.CSSProperties;

/**
 * The node's condition items, first one on top like the cards on the canvas. An invalid item is
 * red; clicking an item selects its card, double-clicking opens its condition file.
 */
export const NodeConditionSection: React.FC<{ selectedNode: EditNode }> = ({ selectedNode }) => {
    const { t } = useTranslation();
    const runtime = useRuntime();
    const nodeDefs = useWorkspaceStore((state) => state.nodeDefs);
    const usingVars = useWorkspaceStore((state) => state.usingVars);
    const usingGroups = useWorkspaceStore((state) => state.usingGroups);
    const strictGroup = useWorkspaceStore((state) => state.settings.strictGroup);
    const checkExpr = useWorkspaceStore((state) => state.settings.checkExpr);
    const conditionImportVars = useWorkspaceStore((state) => state.conditionImportVars);
    const conditions = selectedNode.data.conditions;

    const items = useMemo(() => {
        const defsByName = createNodeDefMap(nodeDefs);
        const ctx = {
            defsByName,
            usingVars,
            usingGroups,
            strictGroup,
            checkExpr,
            conditionImportVars,
        };
        return (conditions ?? []).map((condition) => ({
            name: condition.root.name,
            desc:
                condition.root.desc?.trim() ||
                findNodeDef(defsByName, condition.root.name)?.desc?.trim() ||
                undefined,
            abort: condition.abort,
            invalid: isConditionInvalid(condition, selectedNode.conditionParent, ctx),
        }));
    }, [
        checkExpr,
        conditionImportVars,
        conditions,
        nodeDefs,
        selectedNode.conditionParent,
        strictGroup,
        usingGroups,
        usingVars,
    ]);

    if (items.length === 0) {
        return null;
    }

    return (
        <>
            <SectionDivider>{t("node.conditions")}</SectionDivider>
            <div className="b3-node-condition-list">
                {items.map((item, index) => {
                    const row = (
                        <div
                            key={index}
                            role="button"
                            tabIndex={0}
                            className={
                                item.invalid
                                    ? "b3-node-condition-item b3-node-condition-item-invalid"
                                    : "b3-node-condition-item"
                            }
                            onClick={() =>
                                void runtime.controller.selectNode(selectedNode.ref.instanceKey, {
                                    force: true,
                                    surface: "condition",
                                    conditionIndex: index,
                                })
                            }
                            onDoubleClick={() =>
                                void runtime.controller.openConditionFile(selectedNode.ref, index)
                            }
                            onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    void runtime.controller.selectNode(
                                        selectedNode.ref.instanceKey,
                                        { force: true, surface: "condition", conditionIndex: index }
                                    );
                                }
                            }}
                        >
                            <span className="b3-node-condition-icon" style={conditionIconStyle} />
                            <span className="b3-node-condition-name">{item.name}</span>
                            {item.desc ? (
                                <span className="b3-node-condition-desc">{item.desc}</span>
                            ) : null}
                            <span className="b3-node-condition-abort">{item.abort}</span>
                        </div>
                    );
                    return item.invalid ? (
                        <Tooltip key={index} title={t("node.conditionInvalid")}>
                            {row}
                        </Tooltip>
                    ) : (
                        row
                    );
                })}
            </div>
        </>
    );
};
