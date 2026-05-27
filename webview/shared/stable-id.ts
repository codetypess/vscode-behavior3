import { customAlphabet } from "nanoid";

const UUID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const generateUuid = customAlphabet(UUID_ALPHABET, 10);

const hashString = (value: string): number => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

export const generateDeterministicUuid = (seed: string): string => {
    let state = hashString(seed);
    let result = "";

    for (let index = 0; index < 10; index += 1) {
        state = Math.imul(state ^ (state >>> 16), 2246822519) >>> 0;
        state = (state ^ hashString(`${seed}:${index}`)) >>> 0;
        result += UUID_ALPHABET[state % UUID_ALPHABET.length];
    }

    return result;
};
