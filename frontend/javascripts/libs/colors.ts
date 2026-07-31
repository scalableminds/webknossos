import { presetPalettes } from "@ant-design/colors";
import type { ColorObject, Vector3, Vector4 } from "viewer/constants";

/**
 * Central module for color *utilities*: conversions between the different color
 * representations used across WEBKNOSSOS (hex strings, 0–255 RGB tuples,
 * normalized 0–1 RGB tuples, packed integers) and deterministic string → color
 * mappings.
 *
 * Color *values* deliberately do not live here. Their sources of truth are:
 *  - the Ant Design design tokens, which `theme_provider.tsx` exposes as CSS
 *    variables (`var(--ant-color-text-secondary)`, …). Prefer these in
 *    components – they automatically adapt to the light/dark theme.
 *  - `theme.ts` for the WEBKNOSSOS brand palette (`ColorWKBlue`, …) and the
 *    antd theme configuration derived from it. Use a brand constant only for
 *    colors that must stay identical in both themes.
 */

function intToHex(int: number, digits: number = 6): string {
  return ("0".repeat(digits) + int.toString(16)).slice(-digits);
}

/** Packs a 0–255 RGB tuple into a single integer (0xRRGGBB), e.g. for three.js. */
export function rgbToInt(color: Vector3): number {
  return (color[0] << 16) + (color[1] << 8) + color[2];
}

/** Converts a 0–255 RGB tuple into a "#rrggbb" string. */
export function rgbToHex(color: Vector3): string {
  return `#${color.map((int) => intToHex(Math.round(int), 2)).join("")}`;
}

/** Converts a "#rrggbb" string into a 0–255 RGB tuple. */
export function hexToRgb(hex: string): Vector3 {
  const bigint = Number.parseInt(hex.slice(1), 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return [r, g, b];
}

/**
 * Converts an HSL color value to RGB. Conversion formula
 * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
 * Assumes h, s, l, and a are contained in the set [0, 1] and
 * returns r, g, b, and a in the set [0, 1].
 *
 * Taken from:
 * https://stackoverflow.com/a/9493060
 */
function hslaToRgba(hsla: Vector4): Vector4 {
  const [h, s, l, a] = hsla;
  let r: number;
  let g: number;
  let b: number;

  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const hue2rgb = function hue2rgb(p: number, q: number, t: number) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return [r, g, b, a];
}

export function colorObjectToRGBArray({ r, g, b }: ColorObject): Vector3 {
  return [r, g, b];
}

/** Returns a random, normalized (0–1) RGB tuple. */
export function getRandomColor(): Vector3 {
  // Generate three values between 0 and 1 that multiplied with 255 will be integers.
  const randomColor = [0, 1, 2].map(() => Math.floor(Math.random() * 256) / 255);
  return randomColor as any as Vector3;
}

/**
 * Derives a stable, well-saturated color (normalized 0–1 RGB) from a string, so that e.g. two
 * layers with different names get distinct but deterministic colors.
 *
 * Note: this is unrelated to `stringToTagColor` below, which picks from a small, fixed palette
 * and returns a hex string for use as an antd `<Tag color={…}/>`.
 */
export function stringToNormalizedRgbColor(str: string): Vector3 {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  const hue = (Math.abs(hash) % 360) / 360;
  const [r, g, b] = hslaToRgba([hue, 0.7, 0.6, 1]);
  return [r, g, b];
}

function hashString(string: string, max: number): number {
  let hash = 0;

  for (let i = 0; i < string.length; i++) {
    hash += string.charCodeAt(i);
  }

  return hash % max;
}

/**
 * Fixed palette used for antd `<Tag/>`s that are colored by their label (teams, roles,
 * datastores, …). These are brand-ish accent colors that intentionally stay the same in the
 * light and the dark theme so that a given tag is recognizable across both.
 */
const TAG_COLOR_PALETTE: Array<string> = [
  "#575AFF",
  "#8086FF",
  "#2A0FC6",
  "#40bfd2",
  "#b92779",
  "#FF7BA6",
  "#FF9364",
  "#750790",
];

/** Deterministically maps a string to one of the `TAG_COLOR_PALETTE` colors ("#rrggbb"). */
export function stringToTagColor(string: string): string {
  const hash = hashString(string, TAG_COLOR_PALETTE.length);
  return TAG_COLOR_PALETTE[hash];
}

// Specifying a preset color makes an antd <Tag/> appear more lightweight, see https://ant.design/components/tag/
const ANTD_COLOR_PRESET_NAMES = Object.keys(presetPalettes);

/** Deterministically maps a string to the name of one of antd's preset colors. */
export function stringToAntdColorPreset(string: string): keyof typeof presetPalettes {
  const hash = hashString(string, ANTD_COLOR_PRESET_NAMES.length);
  return ANTD_COLOR_PRESET_NAMES[hash];
}

/** Same as `stringToAntdColorPreset`, but returns the preset's primary color as a 0–255 RGB tuple. */
export function stringToAntdColorPresetRgb(string: string): Vector3 {
  const presetString = stringToAntdColorPreset(string);
  // This will be a hex code, see https://www.npmjs.com/package/@ant-design/colors
  // @ts-expect-error
  return hexToRgb(presetPalettes[presetString].primary);
}
