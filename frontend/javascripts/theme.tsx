import React from "react";
import { useSelector } from "react-redux";
import { App, ConfigProvider, theme } from "antd";
import { APIUserTheme } from "types/api_flow_types";
import type { OxalisState, Theme } from "oxalis/store";
import window from "libs/window";

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
  let token = {};

  if (userTheme === "auto") {
    userTheme = getSystemColorTheme();
  }

  if (userTheme === "dark") {
    algorithm = theme.darkAlgorithm;

    // use a very dark grey instead of pure black as base color for dark mode
    token = { colorBgBase: "rgb(20, 20, 20)" };
  }
  // In case you want customize individual components, adapt the antd design tokens and return them here,
  // e.g., components: { Input: {<designToken>: ...}
  return { algorithm, token };
}

export default function GlobalThemeProvider({ children }: { children?: React.ReactNode }) {
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const antdTheme =
    activeUser == null ? getAntdTheme("auto") : getAntdTheme(activeUser.selectedTheme);

  console.log(antdTheme);

  return (
    <ConfigProvider theme={{ ...antdTheme, cssVar: { key: "antd-app-theme" } }}>
      <App>
        <div
          className={antdTheme.algorithm === theme.darkAlgorithm ? "dark-theme" : undefined}
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
