import { CaretDownFilled } from "@ant-design/icons";
import classnames from "classnames";

/*
 * The expand/collapse icon of the trees in the border tabs.
 *
 * These trees pass `showLine`, for which antd's own switcher is a plus/minus square, and
 * which makes antd tag a custom switcher with `-switcher-line-icon` instead of
 * `-switcher-icon`. Rendering antd's caret and asking for `-switcher-icon` explicitly gives
 * the small caret of antd's default (line-less) tree: that class carries both the 10px size
 * and the rotation transition, and antd rotates the svg of a collapsed node itself.
 *
 * antd clones this element to add its own class, so `className` has to be forwarded.
 */
export function TreeSwitcherIcon({ className }: { className?: string }) {
  return <CaretDownFilled className={classnames("ant-tree-switcher-icon", className)} />;
}
