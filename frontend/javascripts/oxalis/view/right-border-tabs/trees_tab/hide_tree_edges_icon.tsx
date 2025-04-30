import type { WebknossosState } from "oxalis/store";
import type { CSSProperties, StyleHTMLAttributes } from "react";
import { useSelector } from "react-redux";

export function HideTreeEdgesIcon({
  style,
  className,
}: {
  style?: StyleHTMLAttributes<HTMLSpanElement>;
  className?: string;
}) {
  const isDarkTheme = useSelector((state: WebknossosState) => state.uiInformation.theme === "dark");

  const imageUrl = isDarkTheme
    ? 'url("/assets/images/icon-hide-skeleton-edges-light.svg")'
    : 'url("/assets/images/icon-hide-skeleton-edges-dark.svg")';
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
