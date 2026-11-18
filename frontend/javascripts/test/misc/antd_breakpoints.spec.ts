import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// _variables.less mirrors antd's breakpoints because CSS variables can't be used in media queries.
// This test fails if antd (or our theme) changes them, so LESS and Grid.useBreakpoint() stay in sync.
const LESS_TO_TOKEN = {
  "screen-xs-max": "screenXSMax",
  "screen-sm-min": "screenSMMin",
  "screen-sm-max": "screenSMMax",
  "screen-md-min": "screenMDMin",
  "screen-md-max": "screenMDMax",
  "screen-lg-min": "screenLGMin",
  "screen-lg-max": "screenLGMax",
  "screen-xl-min": "screenXLMin",
  "screen-xl-max": "screenXLMax",
  "screen-xxl-min": "screenXXLMin",
} as const;

describe("antd breakpoints in _variables.less", () => {
  const less = fs.readFileSync(
    path.resolve(__dirname, "../../../stylesheets/_variables.less"),
    "utf8",
  );
  // antd is mocked globally (see test/global_mocks.ts), so read the real design tokens.
  const tokenPromise = vi
    .importActual<typeof import("antd")>("antd")
    .then(({ theme }) => theme.getDesignToken());

  it.each(Object.entries(LESS_TO_TOKEN))("@%s matches antd's %s", async (lessName, tokenName) => {
    const token = await tokenPromise;
    const match = less.match(new RegExp(`^@${lessName}: (\\d+)px;$`, "m"));
    expect(match, `@${lessName} is missing`).not.toBeNull();
    expect(Number(match?.[1])).toBe(token[tokenName]);
  });
});
