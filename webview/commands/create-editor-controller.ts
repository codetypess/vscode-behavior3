import type { EditorCommand } from "../shared/contracts";
import { createDocumentCommands } from "./controller-document-commands";
import {
    createMutationCommands,
    runDocumentMutationCompat,
} from "./controller-mutation-commands";
import { createSelectionCommands } from "./controller-selection-commands";
import { createControllerRuntime, type ControllerDeps } from "./controller-runtime";

export const createEditorController = (deps: ControllerDeps): EditorCommand => {
    const runtime = createControllerRuntime(deps);
    return {
        async executeDocumentMutationCompat(mutation) {
            await runDocumentMutationCompat(runtime, mutation);
            return runtime.getSerializedCurrentTree() ?? undefined;
        },
        ...createDocumentCommands(runtime),
        ...createSelectionCommands(runtime),
        ...createMutationCommands(runtime),
    };
};
