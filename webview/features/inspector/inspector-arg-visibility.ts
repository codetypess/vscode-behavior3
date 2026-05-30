import type { NodeArg } from "../../shared/b3type";
import { parseSlotDefinition, type NodeSlotDef } from "../../shared/node-utils";
import { buildNodeSlotArray, getNodeSlotFormValue } from "./inspector-form-values";

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

export const collectHiddenStructuredSlotIndices = (
    slotDefs: readonly NodeSlotDef[],
    visibility: Readonly<Record<number, boolean>>
): number[] => slotDefs.map((_, index) => index).filter((index) => visibility[index] === false);

const areSlotArraysEqual = (
    left: ReadonlyArray<string> | undefined,
    right: ReadonlyArray<string> | undefined
): boolean => {
    if (left === right) {
        return true;
    }
    if (!left || !right) {
        return !left && !right;
    }
    if (left.length !== right.length) {
        return false;
    }
    return left.every((entry, index) => entry === right[index]);
};

export const buildSlotArrayWithoutHiddenVisibility = (
    committedSlots: ReadonlyArray<string> | undefined,
    slotDefs: readonly NodeSlotDef[],
    visibility: Readonly<Record<number, boolean>>
): string[] | undefined => {
    const hiddenIndices = collectHiddenStructuredSlotIndices(slotDefs, visibility);
    if (hiddenIndices.length === 0) {
        return committedSlots as string[] | undefined;
    }

    const normalizedSlotDefs = [...slotDefs];
    const scopedRawSlots = normalizedSlotDefs.map((slot, index) => {
        const variadic = parseSlotDefinition(slot, normalizedSlotDefs, index).variadic;
        const currentValue = getNodeSlotFormValue(
            committedSlots as string[] | undefined,
            index,
            variadic
        );
        return Array.isArray(currentValue) ? [...currentValue] : currentValue;
    }) as Array<string | string[]>;

    hiddenIndices.forEach((index) => {
        const variadic = parseSlotDefinition(
            normalizedSlotDefs[index] ?? "",
            normalizedSlotDefs,
            index
        ).variadic;
        scopedRawSlots[index] = variadic ? [] : "";
    });

    const nextSlots = buildNodeSlotArray(
        normalizedSlotDefs,
        scopedRawSlots,
        committedSlots as string[] | undefined
    );
    return areSlotArraysEqual(committedSlots, nextSlots)
        ? (committedSlots as string[] | undefined)
        : nextSlots;
};
