import Icon from "@ant-design/icons";
import CaretDownIcon from "@images/icons/icon-caret-down.svg?react";
import CaretRightIcon from "@images/icons/icon-caret-right.svg?react";

// antd stretches the switcher over the full row but lays its icon out inline against a
// line height of its own, which leaves the caret above the middle of a taller row. Filling
// the switcher and centering in it is independent of both the row height and `showLine`.
const SWITCHER_ICON_STYLE: React.CSSProperties = {
  fontSize: 12,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
};

/*
 * The expand/collapse icon of the trees in the border tabs.
 *
 * antd would tag whatever we return here with a switcher class of its own, which carries
 * a size and — for a collapsed node — a -90° rotation. We deliberately ignore that class
 * (it is passed in as `className`): with a dedicated caret per state, rotating the
 * collapsed one would point it the wrong way.
 */
export function TreeSwitcherIcon({ expanded }: { expanded?: boolean }) {
  return <Icon component={expanded ? CaretDownIcon : CaretRightIcon} style={SWITCHER_ICON_STYLE} />;
}
