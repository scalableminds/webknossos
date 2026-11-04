import { App, ConfigProvider } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { ToastContextMountRoot } from "libs/toast";
import type React from "react";
import { useEffect } from "react";
import { getActiveTheme, getAntdTheme, getLayoutBackgroundColor } from "theme";

export default function GlobalThemeProvider({
  children,
  isMainProvider = true,
}: {
  children?: React.ReactNode;
  isMainProvider?: boolean;
}) {
  const userTheme = useWkSelector(getActiveTheme);
  const antdTheme = getAntdTheme(userTheme);
  const isDarkMode = userTheme === "dark";

  useEffect(() => {
    // html and body are outside of the ReactDOM, so we have to manually update them.
    const backgroundColor = getLayoutBackgroundColor(userTheme);
    document.body.style.backgroundColor = backgroundColor;
    // Before React mounts, the backend paints html black for dark themes to avoid a white flash.
    // Override that, too: a background on html stops the body background from covering the whole
    // page, so content taller than the viewport would otherwise end on a black background.
    document.documentElement.style.backgroundColor = backgroundColor;
  }, [userTheme]);

  return (
    <ConfigProvider
      theme={{ ...antdTheme, cssVar: { key: "antd-app-theme" } }}
      wave={{ disabled: true }}
    >
      <App>
        <div
          className={isDarkMode ? "dark-theme" : undefined}
          style={{
            background: "var(--ant-color-bg-layout)",
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

/**
 * Restores the user's regular antd theme for its children. Use this for modals that are
 * rendered within a differently themed subtree (e.g., the dark navbar/toolbar), since
 * modals would otherwise inherit that theme.
 */
export function UserThemeConfigProvider({ children }: { children: React.ReactNode }) {
  const userTheme = useWkSelector(getActiveTheme);
  return <ConfigProvider theme={getAntdTheme(userTheme)}>{children}</ConfigProvider>;
}
