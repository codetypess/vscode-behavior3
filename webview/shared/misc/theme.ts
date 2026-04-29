import { ThemeConfig, theme } from "antd";

export const darkThemeConfig: ThemeConfig = {
    cssVar: {},
    algorithm: theme.darkAlgorithm,
    token: {
        colorBgBase: "#0d1117",
        colorBgContainer: "#0d1117",
        colorBgElevated: "#161b22",
        colorBorderSecondary: "#30363d",
        borderRadius: 4,
    },
    components: {
        Tree: {
            borderRadius: 0,
            colorBgContainer: "#010409",
        },
        Tabs: {
            horizontalMargin: "0",
        },
        Layout: {
            headerBg: "#0d1117",
            siderBg: "#010409",
        },
        Dropdown: {
            motionDurationMid: "0.1s",
        },
    },
};

export const lightThemeConfig: ThemeConfig = {
    cssVar: {},
    algorithm: theme.defaultAlgorithm,
    components: {
        Dropdown: {
            motionDurationMid: "0.1s",
        },
    },
};

export const getThemeConfig = (mode: "dark" | "light"): ThemeConfig => {
    return mode === "dark" ? darkThemeConfig : lightThemeConfig;
};
