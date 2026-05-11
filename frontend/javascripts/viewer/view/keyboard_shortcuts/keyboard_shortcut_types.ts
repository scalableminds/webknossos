import type { KeyboardHandler } from "libs/input";
import type { KeyboardShortcutId } from "./keyboard_shortcut_constants";

export type KeyboardShortcutDomain =
  | "GENERAL"
  | "GENERAL_EDITING"
  | "GENERAL_LAYOUT"
  | "GENERAL_COMMENT_TAB"
  | "FLIGHT_NAVIGATION"
  | "FLIGHT_EDITING"
  | "PLANE_NAVIGATION"
  | "PLANE_TOOL_SWITCHING"
  | "PLANE_SKELETON_TOOL"
  | "PLANE_VOLUME_TOOL"
  | "PLANE_BOUNDING_BOX_TOOL"
  | "PLANE_PROOFREADING_TOOL";

// Dot-notation encodes the collision hierarchy: "GENERAL.PLANE.SKELETON" is a
// child of "GENERAL.PLANE" which is a child of "GENERAL".
// All parent collision domains of a domain can be generated with getAllCollidingDomainsOf.
export type KeyboardShortcutCollisionDomain =
  | "GENERAL"
  | "GENERAL.FLIGHT"
  | "GENERAL.PLANE"
  | "GENERAL.PLANE.SKELETON"
  | "GENERAL.PLANE.VOLUME"
  | "GENERAL.PLANE.BOUNDING_BOX"
  | "GENERAL.PLANE.PROOFREADING";

const allCollisionDomains: KeyboardShortcutCollisionDomain[] = [
  "GENERAL",
  "GENERAL.FLIGHT",
  "GENERAL.PLANE",
  "GENERAL.PLANE.SKELETON",
  "GENERAL.PLANE.VOLUME",
  "GENERAL.PLANE.BOUNDING_BOX",
  "GENERAL.PLANE.PROOFREADING",
];
export const LeafCollisionDomains: KeyboardShortcutCollisionDomain[] = [
  "GENERAL.FLIGHT",
  "GENERAL.PLANE.SKELETON",
  "GENERAL.PLANE.VOLUME",
  "GENERAL.PLANE.BOUNDING_BOX",
  "GENERAL.PLANE.PROOFREADING",
];

export type KeyCombination = string[];
export type KeySequence = KeyCombination[];
export type KeySequenceAlternatives = KeySequence[];
export type KeyboardShortcutsMap = Record<KeyboardShortcutId, KeySequenceAlternatives>;
// Stores a mapping from US-Keyboard key to key on the currently active layout.
// The mapping is only used for visual display as it is not guaranteed to be complete.
export type UnmodifiedLayoutMap = Map<string, string>;
export type KeyboardConfiguration = {
  readonly shortcutsConfig: KeyboardShortcutsMap;
  readonly unmodifiedLayoutMap: UnmodifiedLayoutMap;
};

export function getAllCollidingDomainsOf(
  domain: KeyboardShortcutCollisionDomain,
): Set<KeyboardShortcutCollisionDomain> {
  const parts = domain.split(".");
  const collisionDomainParents = parts.map((_, i) =>
    parts.slice(0, i + 1).join("."),
  ) as KeyboardShortcutCollisionDomain[];
  const childCollisionDomains = allCollisionDomains.filter((d) => d.includes(domain));
  return new Set([...collisionDomainParents, ...childCollisionDomains]);
}
export class KeyboardShortcutMetaInfo {
  constructor(
    public description: string,
    public defaultBindings: KeySequenceAlternatives,
    public domain: KeyboardShortcutDomain,
  ) {}

  getCollisionDomain(): KeyboardShortcutCollisionDomain {
    switch (this.domain) {
      case "GENERAL":
      case "GENERAL_EDITING":
      case "GENERAL_LAYOUT":
      case "GENERAL_COMMENT_TAB":
        return "GENERAL";
      case "FLIGHT_NAVIGATION":
      case "FLIGHT_EDITING":
        return "GENERAL.FLIGHT";
      case "PLANE_NAVIGATION":
      case "PLANE_TOOL_SWITCHING":
        return "GENERAL.PLANE";
      case "PLANE_SKELETON_TOOL":
        return "GENERAL.PLANE.SKELETON";
      case "PLANE_VOLUME_TOOL":
        return "GENERAL.PLANE.VOLUME";
      case "PLANE_BOUNDING_BOX_TOOL":
        return "GENERAL.PLANE.BOUNDING_BOX";
      case "PLANE_PROOFREADING_TOOL":
        return "GENERAL.PLANE.PROOFREADING";
    }
  }

  // Returns all possible colliding domains:
  // e.g. GENERAL.PLANE.SKELETON -> [GENERAL, GENERAL.PLANE, GENERAL.PLANE.SKELETON]
  getCollisionDomains(): KeyboardShortcutCollisionDomain[] {
    return [...getAllCollidingDomainsOf(this.getCollisionDomain())];
  }
}

export type KeyboardShortcutHandlerMap = Record<KeyboardShortcutId, KeyboardHandler>;

export const DOMAIN_DISPLAY_NAMES: Record<KeyboardShortcutDomain, string> = {
  GENERAL: "General",
  GENERAL_EDITING: "General Editing",
  GENERAL_LAYOUT: "General Layout",
  GENERAL_COMMENT_TAB: "Comments Tab",
  FLIGHT_NAVIGATION: "Flight Mode Navigation",
  FLIGHT_EDITING: "Flight Mode Editing",
  PLANE_NAVIGATION: "Plane Mode Navigation",
  PLANE_TOOL_SWITCHING: "Plane Mode Tool Switching",
  PLANE_SKELETON_TOOL: "Plane Mode Skeleton Tool",
  PLANE_VOLUME_TOOL: "Plane Mode Volume Tool",
  PLANE_BOUNDING_BOX_TOOL: "Plane Mode Bounding Box Tool",
  PLANE_PROOFREADING_TOOL: "Plane Mode Proofreading Tool",
};
