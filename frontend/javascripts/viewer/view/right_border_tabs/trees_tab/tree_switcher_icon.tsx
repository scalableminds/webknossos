import { DownOutlined } from "@ant-design/icons";

// Adapted from https://ant.design/components/tree#tree-demo-customized-icon
export function TreeSwitcherIcon({ expanded }: { expanded?: boolean }) {
  return (
    <DownOutlined
      style={{ transform: `rotate(${expanded ? 0 : -90}deg)`, transition: "transform 0.3s" }}
    />
  );
}
