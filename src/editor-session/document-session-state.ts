export interface DocumentSessionSnapshot {
    dirty: boolean;
    historyIndex: number;
    historyLength: number;
    lastSavedSnapshot: string | null;
    alertReload: boolean;
    pendingExternalContent: string | null;
}

interface CreateDocumentSessionStateOptions {
    initialContent: string;
    dirty?: boolean;
}

/**
 * Host-side authoritative metadata for the main-document session.
 * Webviews project this state locally, but save/dirty/history/conflict truth
 * and committed main-document mutations converge through the host session.
 */
export class DocumentSessionState {
    private currentSnapshot: string;
    private lastSavedSnapshot: string | null;
    private history: string[];
    private historyIndex: number;
    private forceDirty: boolean;
    private alertReload = false;
    private pendingExternalContent: string | null = null;

    constructor(opts: CreateDocumentSessionStateOptions) {
        this.currentSnapshot = opts.initialContent;
        this.lastSavedSnapshot = opts.initialContent;
        this.history = [opts.initialContent];
        this.historyIndex = 0;
        this.forceDirty = Boolean(opts.dirty);
    }

    getSnapshot(): DocumentSessionSnapshot {
        return {
            dirty: this.computeDirty(),
            historyIndex: this.historyIndex,
            historyLength: this.history.length,
            lastSavedSnapshot: this.lastSavedSnapshot,
            alertReload: this.alertReload,
            pendingExternalContent: this.pendingExternalContent,
        };
    }

    getCurrentSnapshot(): string {
        return this.currentSnapshot;
    }

    canUndo(): boolean {
        return this.historyIndex > 0;
    }

    canRedo(): boolean {
        return this.historyIndex >= 0 && this.historyIndex < this.history.length - 1;
    }

    applyCommittedSnapshot(snapshot: string): boolean {
        if (snapshot === this.currentSnapshot) {
            this.clearReloadConflict();
            return false;
        }

        this.currentSnapshot = snapshot;
        this.clearReloadConflict();

        const existingIndex = this.history.findIndex((entry) => entry === snapshot);
        if (existingIndex >= 0) {
            this.historyIndex = existingIndex;
            return true;
        }

        this.history = [...this.history.slice(0, this.historyIndex + 1), snapshot];
        this.historyIndex = this.history.length - 1;
        return true;
    }

    undo(): string | null {
        return this.applyHistoryIndex(this.historyIndex - 1);
    }

    redo(): string | null {
        return this.applyHistoryIndex(this.historyIndex + 1);
    }

    markSaved(snapshot = this.currentSnapshot): void {
        this.currentSnapshot = snapshot;
        this.lastSavedSnapshot = snapshot;
        this.forceDirty = false;
        this.clearReloadConflict();
    }

    replaceFromDisk(snapshot: string): void {
        this.currentSnapshot = snapshot;
        this.lastSavedSnapshot = snapshot;
        this.history = [snapshot];
        this.historyIndex = 0;
        this.forceDirty = false;
        this.clearReloadConflict();
    }

    showReloadConflict(content: string): void {
        this.alertReload = true;
        this.pendingExternalContent = content;
    }

    clearReloadConflict(): void {
        this.alertReload = false;
        this.pendingExternalContent = null;
    }

    private computeDirty(): boolean {
        return this.forceDirty || this.currentSnapshot !== this.lastSavedSnapshot;
    }

    private applyHistoryIndex(nextIndex: number): string | null {
        if (nextIndex < 0 || nextIndex >= this.history.length) {
            return null;
        }

        this.historyIndex = nextIndex;
        this.currentSnapshot = this.history[nextIndex] ?? this.currentSnapshot;
        this.clearReloadConflict();
        return this.currentSnapshot;
    }
}
