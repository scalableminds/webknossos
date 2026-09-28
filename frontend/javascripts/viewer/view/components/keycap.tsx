import Icon from "@ant-design/icons";
import IconMouseLeftDrag from "@images/icons/icon-statusbar-mouse-left-drag.svg?react";
import IconMouseRightDrag from "@images/icons/icon-statusbar-mouse-right-drag.svg?react";
import IconMouseWheel from "@images/icons/icon-statusbar-mouse-wheel.svg?react";
import type React from "react";

/**
 * A keycap, as used to explain keyboard shortcuts.
 *
 * Deliberately neutral: blue is reserved for links and icons, and a keycap should never be
 * louder than the action it triggers. The styling lives in `_info_tab.less`.
 */
export function Keycap({
  children,
  isGlyph,
  isWide,
}: {
  children: React.ReactNode;
  /** Glyph caps (mouse buttons) are slightly larger to fit the artwork. */
  isGlyph?: boolean;
  /** The drag glyphs carry speed lines beside the mouse and need the extra width. */
  isWide?: boolean;
}) {
  return (
    <span className={`keycap ${isGlyph ? "keycap-glyph" : ""} ${isWide ? "keycap-wide" : ""}`}>
      {children}
    </span>
  );
}

/**
 * Mouse glyphs, taken from the same icon set as the status bar and the keyboard shortcut
 * tables so that a mouse looks the same wherever it is explained. The icons hardcode a
 * grey, but vite-plugin-replace-svg-color rewrites it to currentColor at build time, so
 * they follow the keycap's text color in both themes.
 *
 * The drag variants are wider than they are tall, and `icon: true` fits every icon into a
 * 1em square, so they need a slightly larger size than the wheel to read as the same
 * weight.
 */
export function MouseWheelKeycap() {
  return (
    <Keycap isGlyph>
      <Icon component={IconMouseWheel} aria-label="Mouse wheel" style={{ fontSize: 14 }} />
    </Keycap>
  );
}

export function MouseLeftDragKeycap() {
  return (
    <Keycap isGlyph isWide>
      <Icon
        component={IconMouseLeftDrag}
        aria-label="Drag with the left mouse button"
        style={{ fontSize: 17 }}
      />
    </Keycap>
  );
}

export function MouseRightDragKeycap() {
  return (
    <Keycap isGlyph isWide>
      <Icon
        component={IconMouseRightDrag}
        aria-label="Drag with the right mouse button"
        style={{ fontSize: 17 }}
      />
    </Keycap>
  );
}
