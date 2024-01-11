import React, { useEffect } from "react";
import { useSelector } from "react-redux";
import { App, ConfigProvider, theme } from "antd";
import { APIUserTheme } from "types/api_flow_types";
import window from "libs/window";
import type { OxalisState, Theme } from "oxalis/store";
import type { AliasToken } from "antd/lib/theme/interface";

const ColorWKBlue = "#5660ff"; // WK ~blue/purple

export function getSystemColorTheme(): Theme {
  // @ts-ignore
  return window.matchMedia("(prefers-color-scheme: dark)").media !== "not all" &&
    // @ts-ignore
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function getAntdTheme(userTheme: APIUserTheme) {
  let algorithm = theme.defaultAlgorithm;

  // Ant Design Customizations
  let token: Partial<AliasToken> = {
    colorPrimary: ColorWKBlue,
    fontFamily:
      '"Nunito", "Monospaced Number", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;',
  };

  if (userTheme === "auto") {
    userTheme = getSystemColorTheme();
  }

  if (userTheme === "dark") {
    algorithm = theme.darkAlgorithm;

  }
  // In case you want customize individual components, adapt the antd design tokens and return them here,
  // e.g., components: { Input: {<designToken>: ...}
  return { algorithm, token };
}

export default function GlobalThemeProvider({ children }: { children?: React.ReactNode }) {
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const antdTheme =
    activeUser == null ? getAntdTheme("auto") : getAntdTheme(activeUser.selectedTheme);
  const isDarkMode = antdTheme.algorithm === theme.darkAlgorithm;

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
