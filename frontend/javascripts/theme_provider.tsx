import { App, ConfigProvider } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { ToastContextMountRoot } from "libs/toast";
import type React from "react";
import { useEffect } from "react";
import { ColorBlack, ColorWhite, getAntdTheme, getThemeFromUser } from "theme";

export default function GlobalThemeProvider({
  children,
  isMainProvider = true,
}: {
  children?: React.ReactNode;
  isMainProvider?: boolean;
}) {
  const activeUser = useWkSelector((state) => state.activeUser);
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
