/**
 * SVGR Babel plugin that normalizes icon colors by rewriting:
 * - non-`none` `stroke` values to `currentColor` (when `patchStroke` is enabled)
 * - non-`none` `fill` values to `none` (when `patchFill` is enabled)
 *
 * It handles both direct JSX attributes (`stroke`, `fill`) and
 * inline style object properties (`style={{ stroke: ..., fill: ... }}`).
 *
 * When designing SVG icons, tools like Inkscape or Affinity Designer typically assign
 * fixed colors to paths (e.g., #000 or rgb(123, 123, 123)). While these colors may
 * look good on a light background, they often don't work on dark backgrounds and vice-versa.
 *
 * By setting the color to `currentColor`, the icon will instead inherit the current font color,
 * allowing it to adapt automatically to both dark and light modes.
 *
 * Important limitations:
 * - `currentColor` is a browser-level SVG feature rather than a standard setting in design
 *   software.
 * - SVG paths that already have hardcoded `stroke` or `fill` attributes cannot be styled
 *   from external CSS. This plugin solves that by transforming the SVG source itself.
 */
type ReplaceSvgColorOptions = {
  patchStroke?: boolean;
  patchFill?: boolean;
};

const replaceSvgColorWithCurrentColor = (
  { types: t }: { types: any },
  options: ReplaceSvgColorOptions = {},
) => {
  const { patchStroke = true, patchFill = true } = options;
  const isPatchedAttribute = (name: string) =>
    (name === "stroke" && patchStroke) || (name === "fill" && patchFill);
  const getReplacementValue = (name: "stroke" | "fill") =>
    name === "stroke" ? "currentColor" : "none";
  const isNoneColorValue = (value: unknown) => String(value ?? "").toLowerCase() === "none";

  return {
    visitor: {
      JSXAttribute(path: any) {
        const attributeName = path.node.name;
        if (!t.isJSXIdentifier(attributeName)) {
          return;
        }

        if (isPatchedAttribute(attributeName.name)) {
          const attributeValuePath = path.get("value");
          if (
            attributeValuePath.isStringLiteral() &&
            !isNoneColorValue(attributeValuePath.node.value)
          ) {
            attributeValuePath.replaceWith(
              t.stringLiteral(getReplacementValue(attributeName.name as "stroke" | "fill")),
            );
          }
          return;
        }

        if (attributeName.name !== "style") {
          return;
        }

        const styleValuePath = path.get("value");
        if (!styleValuePath.isJSXExpressionContainer()) {
          return;
        }

        const styleExpressionPath = styleValuePath.get("expression");
        if (!styleExpressionPath.isObjectExpression()) {
          return;
        }

        for (const propertyPath of styleExpressionPath.get("properties")) {
          if (!propertyPath.isObjectProperty()) {
            continue;
          }

          const propertyKeyPath = propertyPath.get("key");
          const isStrokeKey =
            propertyKeyPath.isIdentifier({ name: "stroke" }) ||
            propertyKeyPath.isStringLiteral({ value: "stroke" });
          const isFillKey =
            propertyKeyPath.isIdentifier({ name: "fill" }) ||
            propertyKeyPath.isStringLiteral({ value: "fill" });
          const shouldPatchStroke = isStrokeKey && patchStroke;
          const shouldPatchFill = isFillKey && patchFill;

          if (!shouldPatchStroke && !shouldPatchFill) {
            continue;
          }

          const propertyValuePath = propertyPath.get("value");
          if (
            propertyValuePath.isStringLiteral() &&
            !isNoneColorValue(propertyValuePath.node.value)
          ) {
            propertyValuePath.replaceWith(
              t.stringLiteral(getReplacementValue(shouldPatchStroke ? "stroke" : "fill")),
            );
          }
        }
      },
    },
  };
};

export default replaceSvgColorWithCurrentColor;
