import type { GraphNodeVM } from "../../shared/contracts";
import actionIconUrl from "../../../media/icons/Action.svg";
import compositeIconUrl from "../../../media/icons/Composite.svg";
import conditionIconUrl from "../../../media/icons/Condition.svg";
import debugIconUrl from "../../../media/icons/Debug.svg";
import decoratorIconUrl from "../../../media/icons/Decorator.svg";
import disabledIconUrl from "../../../media/icons/Disabled.svg";
import errorIconUrl from "../../../media/icons/Error.svg";
import otherIconUrl from "../../../media/icons/Other.svg";
import status000IconUrl from "../../../media/icons/status000.svg";
import status001IconUrl from "../../../media/icons/status001.svg";
import status010IconUrl from "../../../media/icons/status010.svg";
import status011IconUrl from "../../../media/icons/status011.svg";
import status100IconUrl from "../../../media/icons/status100.svg";
import status101IconUrl from "../../../media/icons/status101.svg";
import status110IconUrl from "../../../media/icons/status110.svg";
import status111IconUrl from "../../../media/icons/status111.svg";

const readThemeCssVariable = (name: string, fallback: string): string => {
    if (typeof document === "undefined") {
        return fallback;
    }

    for (const element of [document.body, document.documentElement]) {
        if (!element) {
            continue;
        }

        const value = getComputedStyle(element).getPropertyValue(name).trim();
        if (value) {
            return value;
        }
    }

    return fallback;
};

const readThemeCssNumber = (name: string, fallback: number): number => {
    const rawValue = readThemeCssVariable(name, `${fallback}`);
    const value = Number(rawValue);
    return Number.isFinite(value) ? value : fallback;
};

export const getGraphThemeColor = (name: string, fallback: string): string =>
    readThemeCssVariable(name, fallback);

export const getGraphNodePalette = () => ({
    // Keep the collapse control aligned with the V1 editor look instead of
    // inheriting a themed dark pill from VS Code widget colors.
    collapseBg: "#ffffff",
    collapseBorder: "#666666",
    collapseText: "#666666",
    divider: readThemeCssVariable("--b3-node-divider", "#666666"),
    dragSource: readThemeCssVariable("--b3-drag-source", "#ffa500"),
    dropChild: readThemeCssVariable("--b3-drop-child", "#ff4d4f"),
    focusColor: readThemeCssVariable("--b3-node-focus-color", "#ffab00"),
    focusOpacity: readThemeCssNumber("--b3-node-focus-opacity", 0.45),
    grayBorder: readThemeCssVariable("--b3-node-gray-border", "#30363d"),
    grayFill: readThemeCssVariable("--b3-node-gray-fill", "#0d1117"),
    grayRail: readThemeCssVariable("--b3-node-gray-rail", "#30363d"),
    grayText: readThemeCssVariable("--b3-node-gray-text", "#666666"),
    highlightBg: readThemeCssVariable("--b3-node-highlight-bg", "#0d1117"),
    highlightText: readThemeCssVariable("--b3-node-highlight-text", "#ffffff"),
    idStroke: readThemeCssVariable("--b3-node-id-stroke", "#000000"),
    idText: readThemeCssVariable("--b3-node-id-text", "#ffffff"),
    nodeBg: readThemeCssVariable("--b3-node-content-bg", "#ffffff"),
    nodeText: readThemeCssVariable("--b3-node-text", "#111827"),
    overrideBar: readThemeCssVariable("--b3-override-bar", "#d39a21"),
    subtreeOutline: readThemeCssVariable("--b3-subtree-outline", "#a5b1be"),
});

export type GraphNodePalette = ReturnType<typeof getGraphNodePalette>;

export const accentColorMap: Record<GraphNodeVM["nodeStyleKind"], string> = {
    Action: "#1769dd",
    Composite: "#34d800",
    Condition: "#f72585",
    Decorator: "#b2eb35",
    Error: "#ff0000",
    Other: "#707070",
};

export const fallbackNodeIconMap: Record<GraphNodeVM["nodeStyleKind"], string> = {
    Action: actionIconUrl,
    Composite: compositeIconUrl,
    Condition: conditionIconUrl,
    Decorator: decoratorIconUrl,
    Error: errorIconUrl,
    Other: otherIconUrl,
};

export const statusIconMap: Record<number, string> = {
    0: status000IconUrl,
    1: status001IconUrl,
    2: status010IconUrl,
    3: status011IconUrl,
    4: status100IconUrl,
    5: status101IconUrl,
    6: status110IconUrl,
    7: status111IconUrl,
};

export { debugIconUrl, disabledIconUrl, status000IconUrl };
