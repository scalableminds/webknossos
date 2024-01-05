import { ConfigProvider, theme } from "antd";
import { OxalisState, Theme } from "oxalis/store";
import React from "react";
import { useSelector } from "react-redux";
import { APIUserTheme } from "types/api_flow_types";

const globalToken = theme.getDesignToken();

const componentCustomizations = {
  Input: {
    activeBg: globalToken.colorBgBase,
    algorithm: true,
  },
};

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

  if (userTheme === "auto") {
    userTheme = getSystemColorTheme();
  }

  if (userTheme === "dark") {
    console.log("dark")
    algorithm = theme.darkAlgorithm;
  }

  return { algorithm, components: componentCustomizations };
}

export default function GlobalThemeProvider({ children }: { children?: React.ReactNode }) {
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const antdTheme =
    activeUser == null ? getAntdTheme("auto") : getAntdTheme(activeUser.selectedTheme);

  console.log(antdTheme)

  return (
    <ConfigProvider theme={{ ...antdTheme, cssVar: { key: "antd-app-theme" } }}>
      <div className={antdTheme.algorithm === theme.darkAlgorithm ? "dark-theme" : undefined}>
        {children}
      </div>
    </ConfigProvider>
  );
}
