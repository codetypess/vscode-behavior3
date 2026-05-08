import * as fs from "fs";
import * as path from "path";

const isWithinRoot = (rootDir: string, candidateDir: string): boolean => {
    const relative = path.relative(rootDir, candidateDir);
    // path.relative stays inside root unless it climbs with ".." or becomes absolute.
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const toSearchDirectory = (inputPath: string): string => {
    const resolved = path.resolve(inputPath);
    if (!fs.existsSync(resolved)) {
        // Missing file-looking paths still search from their parent; missing directories search as-is.
        return path.extname(resolved) ? path.dirname(resolved) : resolved;
    }

    const stat = fs.statSync(resolved);
    return stat.isDirectory() ? resolved : path.dirname(resolved);
};

const findNearestFileUpward = (
    searchFrom: string,
    suffix: string,
    rootDir?: string
): string | undefined => {
    let dir = path.resolve(searchFrom);
    const boundary = rootDir ? path.resolve(rootDir) : undefined;

    while (true) {
        if (boundary && !isWithinRoot(boundary, dir)) {
            break;
        }

        try {
            const names = fs.readdirSync(dir);
            // Multiple matching files are rare; sorting keeps discovery deterministic.
            const hit = names.filter((name) => name.endsWith(suffix)).sort()[0];
            if (hit) {
                return path.join(dir, hit);
            }
        } catch {
            /* Ignore unreadable folders and continue walking upward. */
        }

        if (boundary && dir === boundary) {
            break;
        }

        const parent = path.dirname(dir);
        if (parent === dir) {
            break;
        }
        dir = parent;
    }

    return undefined;
};

export const findBehaviorWorkspaceFileSync = (
    searchPath: string,
    opts?: { rootDir?: string }
): string | undefined => {
    const resolved = path.resolve(searchPath);
    if (resolved.endsWith(".b3-workspace") && fs.existsSync(resolved)) {
        return resolved;
    }
    return findNearestFileUpward(toSearchDirectory(resolved), ".b3-workspace", opts?.rootDir);
};

export const findBehaviorSettingFileSync = (
    searchPath: string,
    opts?: { rootDir?: string }
): string | undefined => {
    const resolved = path.resolve(searchPath);
    if (resolved.endsWith(".b3-setting") && fs.existsSync(resolved)) {
        return resolved;
    }
    return findNearestFileUpward(toSearchDirectory(resolved), ".b3-setting", opts?.rootDir);
};
