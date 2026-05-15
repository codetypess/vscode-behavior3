import type { PersistedTreeModel, Settings } from "../webview/shared/contracts";

export const createTestTree = (): PersistedTreeModel => ({
    version: "2.0.0",
    name: "main",
    prefix: "",
    export: true,
    group: [],
    variables: {
        imports: [],
        locals: [],
    },
    custom: {},
    overrides: {},
    root: {
        uuid: "root",
        id: "1",
        name: "Sequence",
        children: [],
    },
});

export const createHostInitSettings = (): Settings => ({
    checkExpr: true,
    subtreeEditable: true,
    language: "en",
    theme: "light",
    inspectorMode: "sidebar",
});
