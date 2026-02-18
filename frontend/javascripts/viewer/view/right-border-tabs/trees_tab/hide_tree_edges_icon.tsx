import Icon from "@ant-design/icons";
import { useWkSelector } from "libs/react_hooks";
import type { CSSProperties } from "react";
import IconHideSkeletonEdgesDark from "@images/icons/icon-hide-skeleton-edges-dark.svg?react";
import IconHideSkeletonEdgesLight from "@images/icons/icon-hide-skeleton-edges-light.svg?react";

export function HideTreeEdgesIcon({
  style,
  className,
}: {
  style?: CSSProperties;
  className?: string;
}) {
  const isDarkTheme = useWkSelector((state) => state.uiInformation.theme === "dark");
  const SvgIcon = isDarkTheme ? IconHideSkeletonEdgesLight : IconHideSkeletonEdgesDark;
  const iconStyle: CSSProperties = {
    width: "1em",
    height: "1em",
    display: "inline-block",
    ...style,
  };

  return <Icon component={SvgIcon} style={iconStyle} className={className} />;
}
