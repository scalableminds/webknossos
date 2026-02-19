import Icon from "@ant-design/icons";
import { theme } from "antd";
import type React from "react";
import { useMemo } from "react";

// Eagerly import all SVG icon modules via Vite's import.meta.glob
const lightIcons = import.meta.glob("@images/icons/*-light.svg", { eager: true, query: "?react" });
const darkIcons = import.meta.glob("@images/icons/*-dark.svg", { eager: true, query: "?react" });

/**
 * Returns the current theme mode ("light" or "dark") based on the (local) Ant Design theme token.
 */
export function useThemeMode(): "light" | "dark" {
  const { token } = theme.useToken();
  // In dark algorithm, colorBgBase is #000; in light it's #fff
  return token.colorBgBase === "#000000" || token.colorBgBase === "#000" ? "dark" : "light";
}

interface ThemedIconProps extends React.ComponentProps<typeof Icon> {
  name: string; // e.g. "icon-mouse-left" for "icon-mouse-left-light.svg"
}

/**
 * A component that imports and renders an SVG icon based on the current theme mode.
 */
export function ThemedIcon({ name, ...props }: ThemedIconProps) {
  const mode = useThemeMode();

  const SvgComponent = useMemo(() => {
    const iconSource = mode === "dark" ? darkIcons : lightIcons;
    const key = Object.keys(iconSource).find((k) =>
      k.includes(`/frontend/assets/images/icons/${name}-${mode}.svg`),
    );
    if (!key) {
      console.warn(`ThemedIcon: no icon found for "${name}" in ${mode} mode`);
      return null;
    }

    const Svg = (iconSource[key] as any).default as React.FC<React.SVGProps<SVGSVGElement>>;
    return Svg;
  }, [name, mode]);

  if (!SvgComponent) return null;

  return <Icon component={SvgComponent} {...props} />;
}
