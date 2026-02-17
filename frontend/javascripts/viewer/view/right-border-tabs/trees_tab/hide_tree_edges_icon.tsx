import { useWkSelector } from "libs/react_hooks";
import type { CSSProperties, StyleHTMLAttributes } from "react";
import iconHideSkeletonEdgesDark from "/images/icon-hide-skeleton-edges-dark.svg";
import iconHideSkeletonEdgesLight from "/images/icon-hide-skeleton-edges-light.svg";

export function HideTreeEdgesIcon({
  style,
  className,
}: {
  style?: StyleHTMLAttributes<HTMLSpanElement>;
  className?: string;
}) {
  const isDarkTheme = useWkSelector((state) => state.uiInformation.theme === "dark");

  const imageUrl = isDarkTheme
    ? `url(${iconHideSkeletonEdgesLight})`
    : `url(${iconHideSkeletonEdgesDark})`;
  const iconStyle: CSSProperties = {
    width: "1em",
    height: "1em",
    display: "inline-block",
    backgroundImage: imageUrl,
    backgroundSize: "contain",
    ...style,
  };

  return <i style={iconStyle} className={className} />;
}
