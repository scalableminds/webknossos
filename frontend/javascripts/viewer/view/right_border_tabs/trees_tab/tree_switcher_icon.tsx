import { DownOutlined } from "@ant-design/icons";

const EXPANDED_STYLE = {
  transform: "rotate(0deg)",
  transition: "transform 0.3s",
}

const COLLAPSED_STYLE = {
  transform: "rotate(-90deg)",
  transition: "transform 0.3s",
}

// Adapted from https://ant.design/components/tree#tree-demo-customized-icon
export function TreeSwitcherIcon({ expanded }: { expanded?: boolean }) {
  return (
    <DownOutlined
      style={expanded ? EXPANDED_STYLE : COLLAPSED_STYLE}
    />
  );
}
