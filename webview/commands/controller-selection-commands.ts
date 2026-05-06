import type { EditorCommand } from "../shared/contracts";
import { patchGraphUiSearchState } from "../stores/graph-ui-store";
import type { ControllerRuntime } from "./controller-runtime";

type SelectionCommandKeys =
    | "selectTree"
    | "selectNode"
    | "focusVariable"
    | "openSearch"
    | "updateSearch"
    | "nextSearchResult"
    | "prevSearchResult";

export const createSelectionCommands = (
    runtime: ControllerRuntime
): Pick<EditorCommand, SelectionCommandKeys> => {
    const { deps } = runtime;

    const commands: Pick<EditorCommand, SelectionCommandKeys> = {
        async selectTree() {
            const shouldClearVariableFocus = runtime.clearActiveVariableFocus();
            const needsVisualHint = runtime.getCurrentGraphSelectionKey() !== null;
            deps.hostAdapter.selectTree();

            if (!shouldClearVariableFocus && !needsVisualHint) {
                return;
            }

            if (needsVisualHint) {
                await runtime.showSelectionVisualHint(null);
            }

            if (shouldClearVariableFocus) {
                await runtime.applyVisualState();
            }
        },

        async selectNode(
            nodeKey: string,
            opts?: { force?: boolean; clearVariableFocus?: boolean }
        ) {
            const resolvedGraph = runtime.getResolvedGraph();
            if (!resolvedGraph) {
                return;
            }
            const node = resolvedGraph.nodesByInstanceKey[nodeKey];
            if (!node) {
                return;
            }

            const shouldClearVariableFocus =
                Boolean(opts?.clearVariableFocus) && runtime.clearActiveVariableFocus();
            const needsVisualHint = runtime.getCurrentGraphSelectionKey() !== node.ref.instanceKey;
            deps.hostAdapter.selectNode(node.ref);

            if (needsVisualHint) {
                await runtime.showSelectionVisualHint(node.ref.instanceKey);
            }

            if (shouldClearVariableFocus) {
                await runtime.applyVisualState();
            }
        },

        async focusVariable(names: string[]) {
            deps.graphUiStore.setState((state) => ({
                ...state,
                activeVariableNames: [...names],
            }));
            await runtime.applyVisualState();
        },

        async openSearch(mode: "content" | "id") {
            patchGraphUiSearchState(deps.graphUiStore, {
                open: true,
                mode,
            });
            await runtime.applyVisualState();
        },

        async updateSearch(query: string) {
            patchGraphUiSearchState(deps.graphUiStore, {
                query,
                index: 0,
            });
            await runtime.applyVisualState();
            const { results } = deps.graphUiStore.getState().search;
            if (results.length > 0) {
                await commands.selectNode(results[0], { force: true });
                await deps.graphAdapter.focusNode(results[0]);
            }
        },

        async nextSearchResult() {
            const search = deps.graphUiStore.getState().search;
            if (search.results.length === 0) {
                return;
            }
            const nextIndex = (search.index + 1) % search.results.length;
            patchGraphUiSearchState(deps.graphUiStore, {
                index: nextIndex,
            });
            await runtime.applyVisualState();
            const key = deps.graphUiStore.getState().search.results[nextIndex];
            if (key) {
                await commands.selectNode(key, { force: true });
                await deps.graphAdapter.focusNode(key);
            }
        },

        async prevSearchResult() {
            const search = deps.graphUiStore.getState().search;
            if (search.results.length === 0) {
                return;
            }
            const nextIndex = (search.index + search.results.length - 1) % search.results.length;
            patchGraphUiSearchState(deps.graphUiStore, {
                index: nextIndex,
            });
            await runtime.applyVisualState();
            const key = deps.graphUiStore.getState().search.results[nextIndex];
            if (key) {
                await commands.selectNode(key, { force: true });
                await deps.graphAdapter.focusNode(key);
            }
        },
    };

    return commands;
};
