import React, { useEffect } from "react";
import { useSelector } from "react-redux";
import { App, ConfigProvider, theme } from "antd";
import { APIUser } from "types/api_flow_types";
import window from "libs/window";
import type { OxalisState, Theme } from "oxalis/store";
import type { AliasToken, OverrideToken } from "antd/lib/theme/interface";

const ColorWKBlue = "#5660ff"; // WK ~blue/purple
const ColorWKLinkHover = "#a8b4ff"; // slightly brighter WK Blue
const ColorWKDarkGrey = "#1f1f1f";

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
    },
    Menu: {
      darkItemBg: ColorWKDarkGrey,
      darkPopupBg: ColorWKDarkGrey,
    },
    Tree: {
      colorBgContainer: "transparent",
      directoryNodeSelectedBg: ColorWKBlue,
    },
  };

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

  if (userTheme === "dark") {
    algorithm = theme.darkAlgorithm;
  }
  return { algorithm, token: globalDesignToken, components };
}

export default function GlobalThemeProvider({ children }: { children?: React.ReactNode }) {
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const userTheme = getThemeFromUser(activeUser);
  const antdTheme = getAntdTheme(userTheme);
  const isDarkMode = userTheme === "dark";

  useEffect(() => {
    // body is outside of the ReactDOM, so we have to manually update it
    if (isDarkMode) {
      document.body.style.backgroundColor = "black";
    } else {
      document.body.style.backgroundColor = "white";
    }
  }, [isDarkMode]);

  return (
    <ConfigProvider theme={{ ...antdTheme, cssVar: { key: "antd-app-theme" } }}>
      <App>
        <div
          className={isDarkMode ? "dark-theme" : undefined}
          style={{
            background: "var(--ant-color-bg-base)",
            height: "calc(100vh - var(--navbar-height))",
          }}
        >
          {children}
        </div>
      </App>
    </ConfigProvider>
  );
}
