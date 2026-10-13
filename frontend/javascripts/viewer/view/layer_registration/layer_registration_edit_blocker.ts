import { duplicateAnnotation, editLockedState, reOpenAnnotation } from "admin/rest_api";
import type { APIAnnotationInfo } from "types/api_types";

// Only the owner can work on a layer registration annotation in the layer registration view, and
// only while it is neither archived nor locked. Everyone else can copy it to their own account.
export type LayerRegistrationEditBlocker = "notOwner" | "archived" | "locked";

// Returns null if the user can work on the layer registration annotation.
export function getLayerRegistrationEditBlocker(
  annotation: APIAnnotationInfo,
  activeUserId: string | null | undefined,
): LayerRegistrationEditBlocker | null {
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

export const EDIT_BLOCKER_ACTION_LABELS: Record<LayerRegistrationEditBlocker, string> = {
  notOwner: "Copy to my account",
  archived: "Unarchive",
  locked: "Unlock",
};

export function getEditBlockerDescription(
  annotation: APIAnnotationInfo,
  blocker: LayerRegistrationEditBlocker,
): string {
  switch (blocker) {
    case "notOwner": {
      const ownerName =
        annotation.owner != null
          ? `${annotation.owner.firstName} ${annotation.owner.lastName}`
          : "another user";
      return `This layer registration belongs to ${ownerName}. Copy it to your account to work on it.`;
    }
    case "archived":
      return "This layer registration is archived. Unarchive it to work on it.";
    case "locked":
      return "This layer registration is locked. Unlock it to work on it.";
  }
}

// Removes what keeps the user from working on the layer registration annotation. Resolves with the
// id of the annotation to open, which is a new copy if the user isn't the owner. A copy stays a
// layer registration annotation.
export async function resolveLayerRegistrationEditBlocker(
  annotation: APIAnnotationInfo,
  blocker: LayerRegistrationEditBlocker,
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
