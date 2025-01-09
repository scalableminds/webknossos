import { App, ConfigProvider, theme } from "antd";
import type { AliasToken, OverrideToken } from "antd/lib/theme/interface";
import { ToastContextMountRoot } from "libs/toast";
import window from "libs/window";
import type { OxalisState, Theme } from "oxalis/store";
import type React from "react";
import { useEffect } from "react";
import { useSelector } from "react-redux";
import type { APIUser } from "types/api_flow_types";

const ColorWKBlue = "#5660ff"; // WK ~blue/purple
const ColorWKLinkHover = "#a8b4ff"; // slightly brighter WK Blue
const ColorWKDarkGrey = "#1f1f1f";
const ColorWhite = "white";
const ColorBlack = "black";
const ColorDarkBg = "#383d48";

// Ant Design Customizations
const globalDesignToken: Partial<AliasToken> = {
  colorPrimary: ColorWKBlue,
  colorLink: ColorWKBlue,
  colorLinkHover: ColorWKLinkHover,
  colorInfo: ColorWKBlue,
  blue: ColorWKBlue,
  borderRadius: 4,
  fontFamily:
    '"Nunito", "Monospaced Number", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;',
};

const darkGlobalToken = theme.getDesignToken({
  token: globalDesignToken,
  algorithm: theme.darkAlgorithm,
});

const OverridesForNavbarAndStatusBarTheme: ThemeConfig = {
  components: {
    Radio: {
      buttonCheckedBg: darkGlobalToken.colorPrimary,
      buttonSolidCheckedBg: darkGlobalToken.colorPrimary,
      buttonBg: ColorDarkBg,
    },
    Button: {
      primaryShadow: "none",
    },
  },
  token: {
    colorBgContainer: ColorDarkBg,
    colorBorder: "#4e4e4e",
    colorPrimaryBorder: "#4e4e4e",
    // Use a non-transparent color for disabled backgrounds. Otherwise the
    // erase-buttons which hide under their neighbors would not hide properly.
    colorBgContainerDisabled: "#313131",
  },
};
export const NavAndStatusBarTheme = _.merge(
  getAntdTheme("dark"),
  OverridesForNavbarAndStatusBarTheme,
);

export function getSystemColorTheme(): Theme {
  // @ts-ignore
  return window.matchMedia("(prefers-color-scheme: dark)").media !== "not all" &&
    // @ts-ignore
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function getThemeFromUser(activeUser: APIUser | null | undefined): Theme {
  if (activeUser == null || activeUser.selectedTheme === "auto") return getSystemColorTheme();

  return activeUser.selectedTheme;
}

export function getAntdTheme(userTheme: Theme) {
  let algorithm = theme.defaultAlgorithm;
  const components: OverrideToken = {
    Layout: {
      headerBg: ColorWKDarkGrey,
      footerBg: ColorWKDarkGrey,
      siderBg: userTheme === "dark" ? ColorBlack : ColorWhite,
    },
    Menu: {
      darkItemBg: ColorWKDarkGrey,
      darkPopupBg: ColorWKDarkGrey,
    },
    Tree: {
      colorBgContainer: "transparent",
      directoryNodeSelectedBg: ColorWKBlue,
      titleHeight: 20, // default is 24px,
      marginXXS: 2, // default is 4px; adjust to match checkboxes because of smaller titleHeight
    },
  };

  if (userTheme === "dark") {
    algorithm = theme.darkAlgorithm;
    components.Tree = {
      ...components.Tree,
      nodeSelectedBg: ColorWKBlue,
      nodeHoverBg: ColorWKDarkGrey,
    };
  }
  return {
    algorithm,
    // Without the clone(), the default theme shows dark backgrounds in various components.
    // Apparently, antd mutates this variable?
    token: _.clone(globalDesignToken),
    components,
  };
}

export default function GlobalThemeProvider({
  children,
  isMainProvider = true,
}: { children?: React.ReactNode; isMainProvider?: boolean }) {
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const userTheme = getThemeFromUser(activeUser);
  const antdTheme = getAntdTheme(userTheme);
  const isDarkMode = userTheme === "dark";

  useEffect(() => {
    // body is outside of the ReactDOM, so we have to manually update it
    if (isDarkMode) {
      document.body.style.backgroundColor = ColorBlack;
    } else {
      document.body.style.backgroundColor = ColorWhite;
    }
  }, [isDarkMode]);

  return (
    <ConfigProvider theme={{ ...antdTheme, cssVar: { key: "antd-app-theme" } }}>
      <App>
        <div
          className={isDarkMode ? "dark-theme" : undefined}
          style={{
            background: "var(--ant-color-bg-base)",
            height: isMainProvider ? "calc(100vh - var(--navbar-height))" : "auto",
          }}
        >
          {isMainProvider && <ToastContextMountRoot />}
          {children}
        </div>
      </App>
    </ConfigProvider>
  );
}
