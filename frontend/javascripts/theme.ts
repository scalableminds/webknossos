import { type ThemeConfig, theme } from "antd";
import type { AliasToken, OverrideToken } from "antd/lib/theme/interface";
import window from "libs/window";
import clone from "lodash-es/clone";
import merge from "lodash-es/merge";
import type { APIUser } from "types/api_types";

export type Theme = "light" | "dark";

// This file is the single source of truth for WEBKNOSSOS' *color values* and for the handful of
// non-color design decisions that antd expresses as tokens (see `ModalToken` / `ModalWidth`
// below). Raw hex codes belong here (and only here). Color conversion helpers live in
// libs/colors.ts.
//
// When a component needs a color, prefer these options in order:
//
//  1. A semantic antd component or prop, so that no color has to be named at all:
//     `<Typography.Text type="secondary" | "success" | "warning" | "danger">`,
//     `<Typography.Text disabled>`, `Button type="text"`, … Antd icons render as
//     `fill: currentColor`, so an icon inside one of these inherits the right color, and it
//     keeps following the parent's hover/active/disabled states. Note that the `type` variants
//     map to the `*Text` tokens, which are not always the same as the base token:
//     `type="secondary"` resolves to `colorTextDescription`, i.e. `colorTextTertiary` — not
//     `colorTextSecondary`.
//
//  2. `theme.useToken()`. Its `cssVar.colorX` is the typed equivalent of hand-writing
//     `var(--ant-color-x)` (theme_provider.tsx enables antd's `cssVar` option), while
//     `token.colorX` is the resolved value. Reach for `token` wherever a CSS variable would not
//     be resolved at all: SVG presentation attributes (e.g. `<rect fill>`, as used by
//     react-flow), canvas, three.js, or any color math.
//
//  3. A class in the stylesheets using `var(--ant-…)` — good for a decorative color that would
//     otherwise be repeated inline across many call sites, and the idiomatic place for CSS
//     variables. Note that component-level tokens such as `--ant-form-item-margin-bottom` are
//     only reachable this way; they are not part of the token object in option 2.
//
//  4. One of the brand constants below — only for colors that must stay identical in both the
//     light and the dark theme.
export const ColorWKBlue = "#5660ff"; // WK ~blue/purple
const ColorWKLinkHover = "#a8b4ff"; // slightly brighter WK Blue
const ColorWKDarkGrey = "#1f1f1f";
export const ColorWKBlueZircon = "#59f8e8"; // WK Cyan
export const ColorWKGold = "#ddbc00"; // WK Gold, used for the credit/billing iconography
export const ColorWhite = "white";
export const ColorBlack = "black";
const ColorDarkBg = "#383d48";
// Borders and disabled backgrounds of the always-dark navbar/status bar.
const ColorDarkBorder = "#4e4e4e";
const ColorDarkDisabledBg = "#313131";

// Ant Design Customizations
const globalDesignToken: Partial<AliasToken> = {
  colorPrimary: ColorWKBlue,
  colorLink: ColorWKBlue,
  colorLinkHover: ColorWKLinkHover,
  colorInfo: ColorWKBlue,
  blue: ColorWKBlue,
  borderRadius: 4,
  fontFamily:
    '"Nunito", "Monospaced Number", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif',
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
// <Typography.Title> keeps the sizes of the raw heading tags it replaced.
//
// These are deliberately scoped to the Typography component instead of being put into
// `globalDesignToken`: `fontSizeHeading*` / `lineHeightHeading*` are also consumed by
// Modal, Result, Alert, Avatar, Statistic, Steps, Upload and BackTop. Setting them
// globally would, for example, shrink every modal title from 16px to 14px, because
// antd derives `Modal.titleFontSize` from `fontSizeHeading5`.
//
// Modal no longer relies on that scoping to keep its title size — see `ModalToken` below,
// which pins the title tokens explicitly. The other listed components still do.
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

// antd derives `titleFontSize` from `fontSizeHeading5` and `titleLineHeight` from
// `lineHeightHeading5`, which means a modal title silently follows whatever the heading scale
// does. Pinning both here makes the modal title an independent decision. The values are antd's
// own defaults, so this is visually neutral today; it just stops being accidental.
//
// `titleColor` and `contentBg` are deliberately left derived — they differ between the light and
// the dark algorithm, so hardcoding either would break one of the two themes.
const ModalToken = {
  titleFontSize: 16,
  titleLineHeight: 1.5,
};

// The width scale for modals. Pick one of these instead of a bespoke pixel value, so that
// dialogs of the same kind end up the same size. Omitting `width` is the smallest option and
// the most common one: antd's 520px default suits confirmations and single-input dialogs.
//
// A modal that genuinely does not fit the scale (a bare spinner, a docked panel) may still set
// its own width, but should say why in a comment.
export const ModalWidth = {
  /** Forms. */
  Medium: 600,
  /** Tables and other rich content. */
  Large: 800,
  /** Data-heavy dialogs, e.g. statistics tables and the shortcut configuration. */
  ExtraLarge: 1000,
  /** Dialogs that embed a whole view, e.g. dataset upload and onboarding. */
  Full: "85%",
} as const;

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
    colorBorder: ColorDarkBorder,
    colorPrimaryBorder: ColorDarkBorder,
    // Use a non-transparent color for disabled backgrounds. Otherwise the
    // erase-buttons which hide under their neighbors would not hide properly.
    colorBgContainerDisabled: ColorDarkDisabledBg,
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
    Modal: ModalToken,
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
