import { type NodeArg, hasArgOptions } from "./b3type";

export const getNodeArgRawType = (arg: NodeArg) => {
    return arg.type.match(/^\w+/)![0] as NodeArg["type"];
};

export const isNodeArgArray = (arg: NodeArg) => {
    return arg.type.includes("[]");
};

export const isNodeArgOptional = (arg: NodeArg) => {
    return arg.type.includes("?");
};

type ArgOptionBucket = {
    match?: Record<string, string[]>;
    source: Array<{ name: string; value: unknown }>;
};

const getArgOptionBuckets = (arg: NodeArg): ArgOptionBucket[] | undefined => {
    const options = arg.options;
    if (!Array.isArray(options)) {
        return undefined;
    }
    return options as ArgOptionBucket[];
};

export const getNodeArgOptions = (arg: NodeArg, args: Record<string, unknown>) => {
    if (!hasArgOptions(arg)) {
        return undefined;
    }

    const options = getArgOptionBuckets(arg);
    if (!options?.length) {
        return undefined;
    }

    const defaultMatch = options.find((option) => !option.match);
    if (defaultMatch) {
        return defaultMatch.source;
    }

    return options.find((entry) =>
        Object.entries(entry.match!).every(([key, value]) => {
            const expectedValues = value as unknown[];
            const actualValue = args[key];
            return Array.isArray(expectedValues) && expectedValues.includes(actualValue);
        })
    )?.source;
};

export const checkOneof = (arg: NodeArg, argValue: unknown, inputValue: unknown) => {
    let normalizedArgValue = argValue;
    if (isNodeArgArray(arg) && Array.isArray(normalizedArgValue) && normalizedArgValue.length === 0) {
        normalizedArgValue = undefined;
    }
    normalizedArgValue = normalizedArgValue === undefined ? "" : normalizedArgValue;
    const normalizedInputValue = inputValue ?? "";
    return (
        (normalizedArgValue !== "" && normalizedInputValue === "") ||
        (normalizedArgValue === "" && normalizedInputValue !== "")
    );
};
