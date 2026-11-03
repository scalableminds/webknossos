import type { ItemType } from "antd/es/menu/interface";

// The viewer's "Menu" dropdown is organized into these sections. Both the dataset view and the
// annotation view use them, so that entries appear in the same place in every mode.
export const MenuGroupKeys = {
  ANNOTATION: "annotation",
  SHARE_AND_EXPORT: "share-and-export",
  CUSTOMIZE: "customize",
} as const;

type MenuGroupKey = (typeof MenuGroupKeys)[keyof typeof MenuGroupKeys];

const menuGroupLabels: Record<MenuGroupKey, string> = {
  [MenuGroupKeys.ANNOTATION]: "Annotation",
  [MenuGroupKeys.SHARE_AND_EXPORT]: "Share & Export",
  [MenuGroupKeys.CUSTOMIZE]: "Customize",
};

export type MenuGroup = {
  key: MenuGroupKey;
  items: ItemType[];
};

// Renders the groups as antd menu groups with a heading each. Groups without any entries (e.g.,
// the annotation group in the dataset view) are omitted entirely.
export function toGroupedMenuItems(groups: MenuGroup[]): ItemType[] {
  return groups
    .filter((group) => group.items.length > 0)
    .map((group) => ({
      type: "group",
      key: group.key,
      label: menuGroupLabels[group.key],
      children: group.items,
    }));
}

export function flattenMenuGroups(groups: MenuGroup[]): ItemType[] {
  return groups.flatMap((group) => group.items);
}
