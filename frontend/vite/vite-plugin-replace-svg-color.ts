/**
 * SVGR Babel plugin that normalizes icon colors by rewriting:
 * - non-`none` `stroke` values to `currentColor` (when `patchStroke` is enabled)
 * - non-`none` `fill` values to `currentColor` (when `patchFill` is enabled)
 *
 * It handles both direct JSX attributes (`stroke`, `fill`) and
 * inline style properties, whether they are emitted as JSX style objects
 * (`style={{ stroke: ..., fill: ... }}`) or raw declaration strings.
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

type PatchedAttributeName = "stroke" | "fill";

const replaceSvgColorWithCurrentColor = (
  { types: t }: { types: any },
  options: ReplaceSvgColorOptions = {},
) => {
  const { patchStroke = true, patchFill = true } = options;

  const getPatchedAttributeName = (name: string): PatchedAttributeName | null => {
    if (name === "stroke" && patchStroke) {
      return "stroke";
    }
    if (name === "fill" && patchFill) {
      return "fill";
    }
    return null;
  };
  const getReplacementValue = (name: PatchedAttributeName) =>
    name === "stroke" ? "currentColor" : "currentColor";

  const isNoneColorValue = (value: unknown) =>
    String(value ?? "")
      .trim()
      .toLowerCase() === "none";

  const getReplacementStyleValue = (name: string, value: unknown): string | null => {
    const patchedAttributeName = getPatchedAttributeName(name.toLowerCase());
    if (patchedAttributeName == null || isNoneColorValue(value)) {
      return null;
    }
    return getReplacementValue(patchedAttributeName);
  };

  const patchStyleDeclarations = (styleValue: string): string | null => {
    let didPatch = false;
    const patchedStyleValue = styleValue
      .split(";")
      .map((declaration) => {
        const separatorIndex = declaration.indexOf(":");
        if (separatorIndex === -1) {
          return declaration;
        }

        const rawName = declaration.slice(0, separatorIndex);
        const rawValue = declaration.slice(separatorIndex + 1);
        const replacementValue = getReplacementStyleValue(rawName.trim(), rawValue.trim());

        if (replacementValue == null) {
          return declaration;
        }

        didPatch = true;
        const leadingWhitespace = rawValue.match(/^\s*/)?.[0] ?? "";
        const trailingWhitespace = rawValue.match(/\s*$/)?.[0] ?? "";
        return `${rawName}:${leadingWhitespace}${replacementValue}${trailingWhitespace}`;
      })
      .join(";");

    return didPatch ? patchedStyleValue : null;
  };

  return {
    visitor: {
      JSXAttribute(path: any) {
        const attributeName = path.node.name;
        if (!t.isJSXIdentifier(attributeName)) {
          return;
        }

        const patchedAttributeName = getPatchedAttributeName(attributeName.name);
        if (patchedAttributeName != null) {
          const attributeValuePath = path.get("value");
          if (
            attributeValuePath.isStringLiteral() &&
            !isNoneColorValue(attributeValuePath.node.value)
          ) {
            attributeValuePath.replaceWith(
              t.stringLiteral(getReplacementValue(patchedAttributeName)),
            );
          }
          return;
        }

        if (attributeName.name !== "style") {
          return;
        }

        const styleValuePath = path.get("value");
        if (styleValuePath.isStringLiteral()) {
          const patchedStyleValue = patchStyleDeclarations(styleValuePath.node.value);
          if (patchedStyleValue != null) {
            styleValuePath.replaceWith(t.stringLiteral(patchedStyleValue));
          }
          return;
        }

        if (!styleValuePath.isJSXExpressionContainer()) {
          return;
        }

        const styleExpressionPath = styleValuePath.get("expression");
        if (styleExpressionPath.isStringLiteral()) {
          const patchedStyleValue = patchStyleDeclarations(styleExpressionPath.node.value);
          if (patchedStyleValue != null) {
            styleExpressionPath.replaceWith(t.stringLiteral(patchedStyleValue));
          }
          return;
        }

        if (!styleExpressionPath.isObjectExpression()) {
          return;
        }

        for (const propertyPath of styleExpressionPath.get("properties")) {
          if (!propertyPath.isObjectProperty()) {
            continue;
          }

          const propertyKeyPath = propertyPath.get("key");
          let propertyName: string | null = null;
          if (propertyKeyPath.isIdentifier()) {
            propertyName = propertyKeyPath.node.name;
          } else if (propertyKeyPath.isStringLiteral()) {
            propertyName = propertyKeyPath.node.value;
          }
          if (propertyName == null) {
            continue;
          }

          const propertyValuePath = propertyPath.get("value");
          const replacementValue = propertyValuePath.isStringLiteral()
            ? getReplacementStyleValue(propertyName, propertyValuePath.node.value)
            : null;

          if (replacementValue != null) {
            propertyValuePath.replaceWith(t.stringLiteral(replacementValue));
          }
        }
      },
    },
  };
};

export default replaceSvgColorWithCurrentColor;
