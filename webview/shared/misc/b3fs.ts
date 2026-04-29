import type * as NodeFs from "fs";

/**
 * Node `fs` is only available in the extension host. Webview never calls `setFs`;
 * use `hasFs()` before any disk path in shared code.
 */
let impl: typeof NodeFs | null = null;

export function setFs(fs: typeof NodeFs): void {
    impl = fs;
}

export function hasFs(): boolean {
    return impl !== null;
}

export function getFs(): typeof NodeFs {
    if (!impl) {
        throw new Error(
            "[b3fs] Node fs not set. Extension build must call setFs(require('fs')) first."
        );
    }
    return impl;
}
