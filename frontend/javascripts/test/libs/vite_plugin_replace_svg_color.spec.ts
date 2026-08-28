// @ts-expect-error @babel/core types are not installed; assuming any
import { transformAsync as transformWithBabel } from "@babel/core";
import { transform as transformWithSvgr } from "@svgr/core";
import { describe, expect, it } from "vitest";
import replaceSvgColorWithCurrentColor from "../../../vite/vite-plugin-replace-svg-color";

describe("vite-plugin-replace-svg-color", () => {
  it("preserves unrelated SVGR style properties while patching fill", async () => {
    // source: frontend/assets/images/icons/icon-grip-lines.svg
    const svg = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg width="100%" height="100%" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" xmlns:serif="http://www.serif.com/" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linecap:round;stroke-linejoin:round;stroke-miterlimit:1.4;">
    <g transform="matrix(1,0,0,1,0,-2527)">
        <g id="icon-grip-lines" transform="matrix(1,0,0,1,-6.30607e-14,2527)">
            <rect x="0" y="0" width="1024" height="1024" style="fill:red;"/>
            <g transform="matrix(1,0,0,1,-7.38343e-12,-2682.58)">
                <path d="M128,3295.78L896,3295.78" style="fill:none;stroke:black;stroke-width:72px;"/>
            </g>
            <g transform="matrix(1,0,0,1,-3.85914e-12,-2884.98)">
                <path d="M128,3295.78L896,3295.78" style="fill:none;stroke:black;stroke-width:72px;"/>
            </g>
        </g>
    </g>
</svg>
`;

    const code = await transformWithSvgr(
      svg,
      {
        plugins: ["@svgr/plugin-jsx"],
        jsx: {
          babelConfig: {
            plugins: [[replaceSvgColorWithCurrentColor, { patchStroke: false, patchFill: true }]],
          },
        },
      },
      { componentName: "Icon" },
    );

    expect(code).toContain('fillRule: "evenodd"');
    expect(code).toContain('clipRule: "evenodd"');
    expect(code).toContain('strokeLinecap: "round"');
    expect(code).toContain('strokeLinejoin: "round"');
    expect(code).toContain("strokeMiterlimit: 1.4");
    expect(code).toContain('fill: "currentColor"');
    expect(code).toContain('fill: "none"');
    expect(code).not.toContain('fill: "red"');
  });

  it("patches only targeted declarations in raw style strings", async () => {
    const input =
      '<path style="fill-rule:evenodd;clip-rule:evenodd;fill:red;stroke-linecap:round;" />';

    const result = await transformWithBabel(input, {
      babelrc: false,
      configFile: false,
      parserOpts: { plugins: ["jsx"] },
      plugins: [[replaceSvgColorWithCurrentColor, { patchStroke: false, patchFill: true }]],
    });

    expect(result?.code).toContain(
      'style="fill-rule:evenodd;clip-rule:evenodd;fill:currentColor;stroke-linecap:round;"',
    );
  });

  it("does not patch raw style strings with `fill:none`", async () => {
    const input = '<path style="fill-rule:evenodd;fill:none;stroke-linecap:round;" />';

    const result = await transformWithBabel(input, {
      babelrc: false,
      configFile: false,
      parserOpts: { plugins: ["jsx"] },
      plugins: [[replaceSvgColorWithCurrentColor, { patchStroke: false, patchFill: true }]],
    });

    expect(result?.code).toContain('style="fill-rule:evenodd;fill:none;stroke-linecap:round;"');
    expect(result?.code).not.toContain("currentColor");
  });
});
