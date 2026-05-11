import enTranslation from "../../media/locales/en.json";
import zhTranslation from "../../media/locales/zh.json";

export const supportedLanguages = ["en", "zh"] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

export type RuntimeTranslationKey = keyof typeof enTranslation;
export type RuntimeTranslationParams = Record<string, string | number | boolean | null | undefined>;
type RuntimeTranslationTable = Partial<Record<RuntimeTranslationKey, string>>;

const runtimeTranslations: Record<SupportedLanguage, RuntimeTranslationTable> = {
    en: enTranslation,
    zh: zhTranslation,
};

const INTERPOLATION_PATTERN = /\{\{\s*([^{}\s]+)\s*\}\}/g;

export const normalizeI18nLanguage = (language?: string | null): SupportedLanguage => {
    const value = (language ?? "").toLowerCase();
    return value.startsWith("zh") ? "zh" : "en";
};

const interpolateRuntimeMessage = (
    template: string,
    params?: RuntimeTranslationParams
): string => {
    if (!params) {
        return template;
    }

    return template.replace(INTERPOLATION_PATTERN, (match, key: string) => {
        const value = params[key];
        return value === undefined || value === null ? match : String(value);
    });
};

export const translateRuntimeMessage = (
    language: SupportedLanguage,
    key: RuntimeTranslationKey,
    params?: RuntimeTranslationParams
): string => {
    const template = runtimeTranslations[language][key] ?? runtimeTranslations.en[key] ?? key;
    return interpolateRuntimeMessage(template, params);
};
