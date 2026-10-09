import { duplicateAnnotation, editLockedState, reOpenAnnotation } from "admin/rest_api";
import type { APIAnnotationInfo } from "types/api_types";

// Only the owner can work on an alignment annotation in the alignment view, and only while
// it is neither archived nor locked. Everyone else can copy it to their own account.
export type AlignmentEditBlocker = "notOwner" | "archived" | "locked";

// Returns null if the user can work on the alignment annotation.
export function getAlignmentEditBlocker(
  annotation: APIAnnotationInfo,
  activeUserId: string | null | undefined,
): AlignmentEditBlocker | null {
  if (annotation.owner?.id == null || annotation.owner.id !== activeUserId) {
    return "notOwner";
  }
  if (annotation.state === "Finished") {
    return "archived";
  }
  if (annotation.isLockedByOwner) {
    return "locked";
  }
  return null;
}

export const EDIT_BLOCKER_ACTION_LABELS: Record<AlignmentEditBlocker, string> = {
  notOwner: "Copy to my account",
  archived: "Unarchive",
  locked: "Unlock",
};

export function getEditBlockerDescription(
  annotation: APIAnnotationInfo,
  blocker: AlignmentEditBlocker,
): string {
  switch (blocker) {
    case "notOwner": {
      const ownerName =
        annotation.owner != null
          ? `${annotation.owner.firstName} ${annotation.owner.lastName}`
          : "another user";
      return `This alignment belongs to ${ownerName}. Copy it to your account to work on it.`;
    }
    case "archived":
      return "This alignment is archived. Unarchive it to work on it.";
    case "locked":
      return "This alignment is locked. Unlock it to work on it.";
  }
}

// Removes what keeps the user from working on the alignment annotation. Resolves with the id
// of the annotation to open, which is a new copy if the user isn't the owner. A copy stays an
// alignment annotation.
export async function resolveAlignmentEditBlocker(
  annotation: APIAnnotationInfo,
  blocker: AlignmentEditBlocker,
): Promise<string> {
  switch (blocker) {
    case "notOwner":
      return (await duplicateAnnotation(annotation.id, annotation.typ)).id;
    case "archived":
      await reOpenAnnotation(annotation.id, annotation.typ);
      return annotation.id;
    case "locked":
      await editLockedState(annotation.id, annotation.typ, false);
      return annotation.id;
  }
}
