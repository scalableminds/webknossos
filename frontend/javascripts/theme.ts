import { type ThemeConfig, theme } from "antd";
import type { AliasToken, OverrideToken } from "antd/lib/theme/interface";
import window from "libs/window";
import clone from "lodash-es/clone";
import merge from "lodash-es/merge";
import type { APIUser } from "types/api_types";

export type Theme = "light" | "dark";

export const ColorWKBlue = "#5660ff"; // WK ~blue/purple
const ColorWKLinkHover = "#a8b4ff"; // slightly brighter WK Blue
const ColorWKDarkGrey = "#1f1f1f";
export const ColorWKBlueZircon = "#59f8e8"; // WK Cyan
export const ColorWhite = "white";
export const ColorBlack = "black";
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

const lightGlobalToken = theme.getDesignToken({
  token: globalDesignToken,
  algorithm: theme.defaultAlgorithm,
});

const darkGlobalToken = theme.getDesignToken({
  token: globalDesignToken,
  algorithm: theme.darkAlgorithm,
});

// The heading scale WEBKNOSSOS has always used. It used to be enforced by global
// `h1`–`h5` rules in antd_overwrites.less and now lives here, so that
// <Typography.Title> renders exactly like the raw heading tags it replaced.
//
// These are deliberately scoped to the Typography component instead of being put into
// `globalDesignToken`: `fontSizeHeading*` / `lineHeightHeading*` are also consumed by
// Modal, Result, Alert, Avatar, Statistic, Steps, Upload and BackTop. Setting them
// globally would, for example, shrink every modal title from 16px to 14px, because
// antd derives `Modal.titleFontSize` from `fontSizeHeading5`.
const TypographyHeadingToken = {
  fontSizeHeading1: 36,
  fontSizeHeading2: 30,
  fontSizeHeading3: 24,
  fontSizeHeading4: 18,
  fontSizeHeading5: 14,
  // antd applies `line-height: token.lineHeight` to <App> and to every component root,
  // so raw heading tags have always inherited it. Without pinning these, Typography.Title
  // would use antd's considerably tighter `lineHeightHeading*` defaults (1.21–1.5).
  lineHeightHeading1: lightGlobalToken.lineHeight,
  lineHeightHeading2: lightGlobalToken.lineHeight,
  lineHeightHeading3: lightGlobalToken.lineHeight,
  lineHeightHeading4: lightGlobalToken.lineHeight,
  lineHeightHeading5: lightGlobalToken.lineHeight,
};

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
export const NavAndStatusBarTheme = merge(
  getAntdTheme("dark"),
  OverridesForNavbarAndStatusBarTheme,
);

export function getSystemColorTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").media !== "not all" &&
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
      nodeSelectedBg: lightGlobalToken.blue3,
      titleHeight: 20, // default is 24px,
      marginXXS: 2, // default is 4px; adjust to match checkboxes because of smaller titleHeight
    },
    Typography: TypographyHeadingToken,
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
    token: clone(globalDesignToken),
    components,
    // Disable inheriting from the parent theme, in case we are nesting dark and light mode components
    inherit: false,
  };
}
