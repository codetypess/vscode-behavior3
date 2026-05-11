import { hasFs } from "./b3fs";
import b3path from "./b3path";

const CHECK_SCRIPT_EXTENSIONS = new Set([".ts", ".mts", ".js", ".mjs"]);
const CHECK_SCRIPT_EXCLUDED_SEGMENTS = new Set(["node_modules", ".git", "dist", "build"]);
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isCheckScriptCandidatePath = (relativePath: string) => {
    const normalized = b3path.posixPath(relativePath);
    const lower = normalized.toLowerCase();
    if (lower.endsWith(".d.ts") || lower.includes(".runtime.")) {
        return false;
    }
    const ext = b3path.extname(normalized).toLowerCase();
    if (!CHECK_SCRIPT_EXTENSIONS.has(ext)) {
        return false;
    }
    return !normalized
        .split("/")
        .some((segment) => CHECK_SCRIPT_EXCLUDED_SEGMENTS.has(segment.toLowerCase()));
};

const matchGlobSegment = (pattern: string, value: string) => {
    let regex = "^";
    for (const char of pattern) {
        if (char === "*") {
            regex += "[^/]*";
        } else if (char === "?") {
            regex += "[^/]";
        } else {
            regex += escapeRegExp(char);
        }
    }
    regex += "$";
    return new RegExp(regex).test(value);
};

const matchGlobSegments = (
    patternSegments: string[],
    pathSegments: string[],
    patternIndex = 0,
    pathIndex = 0
): boolean => {
    if (patternIndex === patternSegments.length) {
        return pathIndex === pathSegments.length;
    }

    const pattern = patternSegments[patternIndex];
    if (pattern === "**") {
        // Let ** consume zero or more path segments.
        for (let nextPathIndex = pathIndex; nextPathIndex <= pathSegments.length; nextPathIndex += 1) {
            if (
                matchGlobSegments(
                    patternSegments,
                    pathSegments,
                    patternIndex + 1,
                    nextPathIndex
                )
            ) {
                return true;
            }
        }
        return false;
    }

    if (pathIndex >= pathSegments.length) {
        return false;
    }
    return (
        matchGlobSegment(pattern, pathSegments[pathIndex]) &&
        matchGlobSegments(patternSegments, pathSegments, patternIndex + 1, pathIndex + 1)
    );
};

const normalizeCheckScriptPattern = (pattern: string) =>
    b3path
        .posixPath(pattern)
        .replace(/^\.\/+/, "")
        .replace(/^\/+/, "");

const matchesCheckScriptPattern = (relativePath: string, pattern: string) => {
    const normalizedPath = b3path.posixPath(relativePath);
    const normalizedPattern = normalizeCheckScriptPattern(pattern);
    return matchGlobSegments(normalizedPattern.split("/"), normalizedPath.split("/"));
};

export const resolveCheckScriptPaths = (
    workdir: string,
    patterns: readonly string[] | undefined
): { paths: string[]; missingPatterns: string[] } => {
    if (!patterns?.length || !hasFs()) {
        return { paths: [], missingPatterns: [] };
    }

    const matchesByPattern = new Map(patterns.map((pattern) => [pattern, 0]));
    const pathSet = new Set<string>();
    for (const absolutePath of b3path.lsdir(workdir, true)) {
        const relativePath = b3path.relative(workdir, absolutePath);
        if (!isCheckScriptCandidatePath(relativePath)) {
            continue;
        }
        for (const pattern of patterns) {
            if (matchesCheckScriptPattern(relativePath, pattern)) {
                pathSet.add(absolutePath);
                matchesByPattern.set(pattern, (matchesByPattern.get(pattern) ?? 0) + 1);
            }
        }
    }

    // Missing patterns are surfaced as build errors so typos do not silently disable checks.
    return {
        paths: [...pathSet].sort(),
        missingPatterns: [...matchesByPattern.entries()]
            .filter(([, count]) => count === 0)
            .map(([pattern]) => pattern),
    };
};
