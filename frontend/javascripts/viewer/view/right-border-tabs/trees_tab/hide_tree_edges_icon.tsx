import Icon from "@ant-design/icons";
import IconHideSkeletonEdgesDark from "@images/icons/icon-hide-skeleton-edges-dark.svg?react";
import IconHideSkeletonEdgesLight from "@images/icons/icon-hide-skeleton-edges-light.svg?react";
import { useWkSelector } from "libs/react_hooks";

export function HideTreeEdgesIcon({ className }: { className?: string }) {
  const isDarkTheme = useWkSelector((state) => state.uiInformation.theme === "dark");
  const SvgIcon = isDarkTheme ? IconHideSkeletonEdgesLight : IconHideSkeletonEdgesDark;

  return <Icon component={SvgIcon} className={className} />;
}
