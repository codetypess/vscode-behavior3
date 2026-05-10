import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import type { MessageInstance } from "antd/es/message/interface";
import type { ModalStaticFunctions } from "antd/es/modal/confirm";
import type { NotificationInstance } from "antd/es/notification/interface";
import { normalizeI18nLanguage } from "./i18n";

export const getAntdLocale = (language?: string | null) =>
    normalizeI18nLanguage(language) === "zh" ? zhCN : enUS;

export interface AppHooks {
    message: MessageInstance;
    notification: NotificationInstance;
    modal: Omit<ModalStaticFunctions, "warn">;
}

export interface AppHooksStore {
    bind(hooks: AppHooks): void;
    reset(): void;
    getMessage(): MessageInstance;
    getNotification(): NotificationInstance;
    getModal(): Omit<ModalStaticFunctions, "warn">;
}

const createUnboundHooksError = (kind: string) =>
    new Error(`${kind} is not available before the Ant Design app hooks are bound`);

export const createAppHooksStore = (): AppHooksStore => {
    let hooks: AppHooks | null = null;

    return {
        bind(nextHooks) {
            hooks = nextHooks;
        },
        reset() {
            hooks = null;
        },
        getMessage() {
            if (!hooks) {
                throw createUnboundHooksError("message");
            }
            return hooks.message;
        },
        getNotification() {
            if (!hooks) {
                throw createUnboundHooksError("notification");
            }
            return hooks.notification;
        },
        getModal() {
            if (!hooks) {
                throw createUnboundHooksError("modal");
            }
            return hooks.modal;
        },
    };
};
