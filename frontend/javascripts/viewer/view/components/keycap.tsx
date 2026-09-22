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
}: {
  children: React.ReactNode;
  /** Glyph caps (mouse buttons) are slightly larger to fit the artwork. */
  isGlyph?: boolean;
}) {
  return <span className={`keycap ${isGlyph ? "keycap-glyph" : ""}`}>{children}</span>;
}

const glyphProps = {
  width: 12,
  height: 16,
  viewBox: "0 0 12 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.3,
  strokeLinecap: "round",
} as const;

/**
 * Mouse glyphs for keycaps. The buttons and the scroll wheel must stay distinguishable at
 * this size, so each button fills its own top quadrant while the wheel fills a centered
 * stub — without that, all three would collapse into the same empty pill.
 */
export function MouseLeftButtonKeycap() {
  return (
    <Keycap isGlyph>
      <svg {...glyphProps} role="img">
        <title>Left mouse button</title>
        <path d="M1.3 6.2V5.7A4.7 4.7 0 0 1 6 1v5.2z" fill="currentColor" stroke="none" />
        <rect x="1.3" y="1" width="9.4" height="14" rx="4.7" />
        <path d="M1.3 6.2h9.4" />
      </svg>
    </Keycap>
  );
}

export function MouseRightButtonKeycap() {
  return (
    <Keycap isGlyph>
      <svg {...glyphProps} role="img">
        <title>Right mouse button</title>
        <path d="M10.7 6.2V5.7A4.7 4.7 0 0 0 6 1v5.2z" fill="currentColor" stroke="none" />
        <rect x="1.3" y="1" width="9.4" height="14" rx="4.7" />
        <path d="M1.3 6.2h9.4" />
      </svg>
    </Keycap>
  );
}

export function MouseWheelKeycap() {
  return (
    <Keycap isGlyph>
      <svg {...glyphProps} role="img">
        <title>Mouse wheel</title>
        <rect x="1.3" y="1" width="9.4" height="14" rx="4.7" />
        <rect x="4.7" y="3.2" width="2.6" height="4.4" rx="1.3" fill="currentColor" stroke="none" />
      </svg>
    </Keycap>
  );
}
