import { type MappingAlgorithm, type ThemeConfig, theme } from "antd";
import type { AliasToken, OverrideToken } from "antd/es/theme/interface";
import window from "libs/window";
import merge from "lodash-es/merge";
import type { APIUser } from "types/api_types";

export type Theme = "light" | "dark";

// This file is the single source of truth for WEBKNOSSOS' *color values*. Raw hex codes belong
// here (and only here). Color conversion helpers live in libs/colors.ts.
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
export const ColorWKBlue = "#5660ff"; // DS "Indigo" (primary)
export const ColorWKBlueZircon = "#59f8e8"; // DS "Mint", apply by hand for rare highlights only
export const ColorWKGold = "#ddbc00"; // WK Gold, used for the credit/billing iconography
export const ColorWhite = "white";
const ColorWKDarkGrey = "#1f1f1f";

// Colors of the WEBKNOSSOS design system (theme v2.1). The names match the design guidelines.
const ColorIndigoLight = "#8a90ff"; // DS "Indigo Light": indigo used as text/links on ink
const ColorViewerInk = "#0c0d18"; // DS "Viewer Ink": dark page background
const ColorPaper = "#f5f5fa"; // DS "Paper": light page background
const ColorTextOnInkPrimary = "#ffffff";
const ColorTextOnInkSecondary = "#a7a9c6";
const ColorHairlineOnInk = "rgba(255, 255, 255, 0.12)";
const ColorTextOnPaperPrimary = "#14152b";
const ColorInk2 = "#14162a"; // DS "Ink-2": background of the always-dark navbar and status bar
const ColorInk3 = "#282c4e"; // DS "Ink-3": controls (buttons, inputs, …) on Ink-2

// Colors introduced for the product UI that are not (yet) part of the design system.
const ColorInkCard = "#161721"; // cards on ink
const ColorInkElevated = "#1f202a"; // popovers, dropdowns, modals
const ColorTextOnInkMuted = "#8c8ead"; // labels, descriptions
const ColorTextOnInkSubtle = "#6e7194"; // hints, icons
const ColorIndigoLightHover = "#a9aeff";
const ColorIndigoLightPressed = "#7c82f0";
const ColorOutlineOnInkHover = "rgba(255, 255, 255, 0.32)";
const ColorOutlineOnInkPressed = "rgba(255, 255, 255, 0.24)";
const ColorOutlineOnPaperHover = "rgba(20, 21, 43, 0.32)";
const ColorOutlineOnPaperPressed = "rgba(20, 21, 43, 0.45)";
const ColorShadowOnInk = "rgba(0, 0, 0, 0.6)"; // replaces antd's white (glowing) dark shadow
// antd's dark disabled background (8% white), pre-blended onto Ink-2 to make it opaque.
const ColorInk2Disabled = "#27293b";

// Hanken Grotesk / IBM Plex Mono are bundled (see main.less); the rest of each stack only
// appears if the web font fails to load. Keep in sync with @font-family in _variables.less.
export const WK_FONT =
  "'Hanken Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
export const WK_MONO =
  "'IBM Plex Mono', SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace";

// Ant Design Customizations
// Principle: override as little as possible and let antd derive the rest, so that antd upgrades
// keep flowing without a full re-review.
const globalDesignToken: Partial<AliasToken> = {
  colorPrimary: ColorWKBlue, // fills: primary buttons, switches, sliders, selection
  colorInfo: ColorWKBlue,
  blue: ColorWKBlue,
  borderRadius: 4,
  fontFamily: WK_FONT,
  fontFamilyCode: WK_MONO,
  controlOutlineWidth: 0, // no indigo halo around focused inputs (the border still turns indigo)
};

const lightDesignToken: Partial<AliasToken> = {
  colorBgLayout: ColorPaper,
};

// `colorShadow` is consumed by antd at runtime (it derives all box shadows), but is missing from
// its public AliasToken type.
const darkDesignToken: Partial<AliasToken> & { colorShadow: string } = {
  // Surfaces. colorBgBase is intentionally not set, since it would tint every derived grey.
  colorBgLayout: ColorViewerInk, // page background
  colorBgContainer: ColorInkCard, // cards
  colorBgElevated: ColorInkElevated, // popovers, dropdowns, modals

  // Lines
  colorBorderSecondary: ColorHairlineOnInk, // card borders, table rules
  colorSplit: ColorHairlineOnInk, // dividers

  // Text: grey for normal text, white only for headings
  colorText: ColorTextOnInkSecondary,
  colorTextHeading: ColorTextOnInkPrimary,
  colorTextSecondary: ColorTextOnInkMuted,
  colorTextTertiary: ColorTextOnInkSubtle,

  // Indigo used as text becomes Indigo Light
  colorPrimaryText: ColorIndigoLight,
  colorPrimaryTextHover: ColorIndigoLightHover,
  colorPrimaryTextActive: ColorIndigoLightPressed,
  // colorLink is a seed token that the dark algorithm would dim, see darkAlgorithm below.
  colorLinkHover: ColorIndigoLightHover,
  colorLinkActive: ColorIndigoLightPressed,

  colorShadow: ColorShadowOnInk,
};

// antd's dark algorithm derives colorLink from the seed's palette, which dims Indigo Light by ~15%.
// Wrapping the algorithm pins the exact design-system color instead.
const darkAlgorithm: MappingAlgorithm = (seedToken, mapToken) => ({
  ...theme.darkAlgorithm(seedToken, mapToken),
  colorLink: ColorIndigoLight,
});

const flatButtonToken = { primaryShadow: "none", defaultShadow: "none", dangerShadow: "none" };

// Default/dashed buttons get a neutral outline on hover/press. Indigo is reserved for solid fills.
const lightButtonToken = {
  ...flatButtonToken,
  defaultHoverColor: ColorTextOnPaperPrimary,
  defaultHoverBorderColor: ColorOutlineOnPaperHover,
  defaultActiveColor: ColorTextOnPaperPrimary,
  defaultActiveBorderColor: ColorOutlineOnPaperPressed,
};

const darkButtonToken = {
  ...flatButtonToken,
  defaultHoverColor: ColorTextOnInkPrimary,
  defaultHoverBorderColor: ColorOutlineOnInkHover,
  defaultActiveColor: ColorTextOnInkPrimary,
  defaultActiveBorderColor: ColorOutlineOnInkPressed,
};

const lightGlobalToken = theme.getDesignToken({
  token: { ...globalDesignToken, ...lightDesignToken },
  algorithm: theme.defaultAlgorithm,
});

const darkGlobalToken = theme.getDesignToken({
  token: { ...globalDesignToken, ...darkDesignToken },
  algorithm: darkAlgorithm,
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

  // antd colors the `confirm` dialog's icon with `colorWarning`, because one CSS rule covers both
  // `-warning` and `-confirm` (antd/lib/modal/style/confirm.js). Every confirmation therefore
  // renders a yellow icon, which reads as a warning even for an ordinary question. Scoping
  // `colorWarning` to Modal re-points that single declaration at the WEBKNOSSOS blue --
  // `colorWarning` is used exactly once in the whole Modal stylesheet, so nothing else moves.
  //
  // This is only safe because we never call `modal.warning()` / `modal.warn()`. If a warning
  // dialog is ever added it would silently lose its warning color, and this needs revisiting.
  // `modal.error` and `modal.info` are unaffected: they use `colorError` and `colorInfo`, and
  // `colorInfo` is already ColorWKBlue via `globalDesignToken`.
  colorWarning: ColorWKBlue,
};

// The width scale for modals. Pick one of these instead of a bespoke pixel value, so that
// dialogs of the same kind end up the same size. Omitting `width` is the smallest option and
// the most common one: antd's 520px default suits confirmations and single-input dialogs.
//
// A modal that genuinely does not fit the scale (a bare spinner, a docked panel) may still set
// its own width, but should say why in a comment.
export const ModalWidth = {
  // Forms
  Medium: 600,
  // Tables and other rich content
  Large: 800,
  // Data-heavy dialogs, e.g. statistics tables and the shortcut configuration
  ExtraLarge: 1000,
  // Dialogs that embed a whole view, e.g. dataset upload and onboarding
  Full: "85%",
} as const;

// The navbar and status bar are always dark, regardless of the user's theme. They use the regular
// dark theme, except that their surface is Ink-2 and the controls on it are Ink-3.
const OverridesForNavbarAndStatusBarTheme: ThemeConfig = {
  token: {
    colorBgContainer: ColorInk3,
    // Use a non-transparent color for disabled backgrounds. Otherwise the
    // erase-buttons which hide under their neighbors would not hide properly.
    colorBgContainerDisabled: ColorInk2Disabled,
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

// The page background, for elements outside of antd's CSS variable scope (e.g. <body>).
export function getLayoutBackgroundColor(userTheme: Theme): string {
  return userTheme === "dark" ? darkGlobalToken.colorBgLayout : lightGlobalToken.colorBgLayout;
}

export function getAntdTheme(userTheme: Theme) {
  const isDark = userTheme === "dark";
  const components: OverrideToken = {
    Layout: {
      headerBg: ColorInk2,
      footerBg: ColorInk2,
      siderBg: isDark ? ColorViewerInk : ColorWhite,
    },
    Menu: {
      // The navbar menus use theme="dark" in both user themes, so their text colors follow the
      // dark theme here, too.
      darkItemBg: ColorInk2,
      darkPopupBg: ColorInkElevated,
      darkItemColor: ColorTextOnInkSecondary,
      darkItemHoverColor: ColorTextOnInkPrimary,
    },
    Tree: {
      colorBgContainer: "transparent",
      nodeSelectedBg: lightGlobalToken.blue3,
      titleHeight: 20, // default is 24px,
      marginXXS: 2, // default is 4px; adjust to match checkboxes because of smaller titleHeight
    },
    Typography: TypographyHeadingToken,
    Modal: ModalToken,
    Button: isDark ? darkButtonToken : lightButtonToken,
  };

  if (isDark) {
    components.Tree = {
      ...components.Tree,
      nodeSelectedBg: ColorWKBlue,
      nodeHoverBg: ColorWKDarkGrey,
    };
    // These components color selected *text* with colorPrimary directly.
    components.Menu = {
      ...components.Menu,
      itemSelectedColor: ColorIndigoLight,
      horizontalItemSelectedColor: ColorIndigoLight,
    };
    components.Tabs = {
      itemSelectedColor: ColorIndigoLight,
      itemHoverColor: ColorIndigoLightHover,
      itemActiveColor: ColorIndigoLight,
    };
  }
  return {
    algorithm: isDark ? darkAlgorithm : theme.defaultAlgorithm,
    // Without the copy, the default theme shows dark backgrounds in various components.
    // Apparently, antd mutates this variable?
    token: { ...globalDesignToken, ...(isDark ? darkDesignToken : lightDesignToken) },
    components,
    // Disable inheriting from the parent theme, in case we are nesting dark and light mode components
    inherit: false,
  };
}
