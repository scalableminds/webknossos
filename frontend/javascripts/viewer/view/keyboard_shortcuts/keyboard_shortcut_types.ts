import type { KeyboardHandler } from "libs/input";
import type { KeyboardShortcutId } from "./keyboard_shortcut_constants";

export type KeyboardShortcutDomain =
  | "GENERAL"
  | "GENERAL_EDITING"
  | "GENERAL_LAYOUT"
  | "GENERAL_COMMENT_TAB"
  | "ARBITRARY_NAVIGATION"
  | "ARBITRARY_EDITING"
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
  | "GENERAL.ARBITRARY"
  | "GENERAL.PLANE"
  | "GENERAL.PLANE.SKELETON"
  | "GENERAL.PLANE.VOLUME"
  | "GENERAL.PLANE.BOUNDING_BOX"
  | "GENERAL.PLANE.PROOFREADING";

export const LeafCollisionDomains: KeyboardShortcutCollisionDomain[] = [
  "GENERAL.ARBITRARY",
  "GENERAL.PLANE.SKELETON",
  "GENERAL.PLANE.VOLUME",
  "GENERAL.PLANE.BOUNDING_BOX",
  "GENERAL.PLANE.PROOFREADING",
];

export type KeyCombination = string[];
export type KeySequence = KeyCombination[];
export type KeySequenceAlternatives = KeySequence[];
export type KeyboardShortcutsMap = Record<KeyboardShortcutId, KeySequenceAlternatives>;

export function getAllCollidingDomainsOf(domain: KeyboardShortcutCollisionDomain) {
  const parts = domain.split(".");
  return parts.map((_, i) => parts.slice(0, i + 1).join(".")) as KeyboardShortcutCollisionDomain[];
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
      case "ARBITRARY_NAVIGATION":
      case "ARBITRARY_EDITING":
        return "GENERAL.ARBITRARY";
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
    return getAllCollidingDomainsOf(this.getCollisionDomain());
  }
}

export type KeyboardShortcutHandlerMap = Record<KeyboardShortcutId, KeyboardHandler>;

export const DOMAIN_DISPLAY_NAMES: Record<KeyboardShortcutDomain, string> = {
  GENERAL: "General",
  GENERAL_EDITING: "General Editing",
  GENERAL_LAYOUT: "General Layout",
  GENERAL_COMMENT_TAB: "General Comment Tab",
  ARBITRARY_NAVIGATION: "Arbitrary Navigation",
  ARBITRARY_EDITING: "Arbitrary Editing",
  PLANE_NAVIGATION: "Plane Navigation",
  PLANE_TOOL_SWITCHING: "Plane Tool Switching",
  PLANE_SKELETON_TOOL: "Plane Skeleton Tool",
  PLANE_VOLUME_TOOL: "Plane Volume Tool",
  PLANE_BOUNDING_BOX_TOOL: "Plane Bounding Box Tool",
  PLANE_PROOFREADING_TOOL: "Plane Proofreading Tool",
};
