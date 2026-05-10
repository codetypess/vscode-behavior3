export type ParsedSlotDefinition = {
    raw: string;
    label: string;
    required: boolean;
    variadic: boolean;
};

const cleanSlotLabel = (value: string) => value.replace(/\.\.\.$/, "").replace(/\?/g, "");

export const parseSlotDefinition = (
    slot: string,
    slotDefs?: readonly string[] | null,
    index?: number
): ParsedSlotDefinition => {
    const raw = slot ?? "";
    const hasOptionalMarker = raw.includes("?");
    const hasVariadicMarker = raw.endsWith("...");
    const variadic =
        hasVariadicMarker &&
        (slotDefs && index !== undefined ? index === slotDefs.length - 1 : true);

    return {
        raw,
        label: cleanSlotLabel(raw),
        required: !hasOptionalMarker,
        variadic,
    };
};
