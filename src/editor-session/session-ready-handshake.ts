import type { FileVersionGuard } from "./document/file-version-guard";
import type { SessionInspectorSync } from "./session-inspector-sync";
import type { HostMessageSink, TreeEditorSessionContext } from "./session-context";
import type { SessionSubtreeTracking } from "./session-subtree-tracking";

export interface SessionReadyHandshake {
    handleReadyMessage(reply?: HostMessageSink): Promise<void>;
}

export function createSessionReadyHandshake(
    context: TreeEditorSessionContext,
    inspectorSync: SessionInspectorSync,
    subtreeTracking: SessionSubtreeTracking,
    fileVersionGuard: FileVersionGuard
): SessionReadyHandshake {
    const { document, initialRevealTarget, postMessage } = context;
    const {
        buildInspectorVarsMessage,
        notifyInspectorSessionUpdate,
        refreshLatestVarDeclsFromContent,
    } = inspectorSync;
    const { refreshTrackedSubtreeRefs } = subtreeTracking;
    const { updateFileVersionState } = fileVersionGuard;
    let pendingInitialRevealTarget = initialRevealTarget;

    /**
     * Handshake entry point: send immutable bootstrap state first, then follow
     * up with computed var/subtree metadata that depends on project indexing.
     */
    const handleReadyMessage = async (reply: HostMessageSink = postMessage): Promise<void> => {
        const content = document.content;

        updateFileVersionState(content, { showWarning: true });

        await Promise.all([refreshLatestVarDeclsFromContent(content), refreshTrackedSubtreeRefs()]);

        await reply(inspectorSync.buildInitMessage({ content }));

        await reply(buildInspectorVarsMessage());
        if (pendingInitialRevealTarget) {
            await reply({
                type: "relayFocusNode",
                target: pendingInitialRevealTarget,
            });
            pendingInitialRevealTarget = null;
        }

        notifyInspectorSessionUpdate();
    };

    return {
        handleReadyMessage,
    };
}
