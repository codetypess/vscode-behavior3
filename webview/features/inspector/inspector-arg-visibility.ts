import type { NodeArg } from "../../shared/b3type";

export const filterStructuredArgsByVisibility = (
    args: readonly NodeArg[],
    visibility: Readonly<Record<string, boolean>>
): NodeArg[] => args.filter((arg) => visibility[arg.name] !== false);

export const collectHiddenStructuredArgNames = (
    args: readonly NodeArg[],
    visibility: Readonly<Record<string, boolean>>
): string[] => args.filter((arg) => visibility[arg.name] === false).map((arg) => arg.name);

export const buildArgsWithoutHiddenVisibility = (
    committedArgs: Readonly<Record<string, unknown>> | undefined,
    args: readonly NodeArg[],
    visibility: Readonly<Record<string, boolean>>
): Record<string, unknown> | undefined => {
    if (!committedArgs) {
        return committedArgs;
    }

    const hiddenArgNames = collectHiddenStructuredArgNames(args, visibility).filter(
        (argName) => argName in committedArgs
    );
    if (hiddenArgNames.length === 0) {
        return committedArgs;
    }

    const nextArgs = { ...committedArgs };
    hiddenArgNames.forEach((argName) => {
        delete nextArgs[argName];
    });
    return Object.keys(nextArgs).length > 0 ? nextArgs : undefined;
};
