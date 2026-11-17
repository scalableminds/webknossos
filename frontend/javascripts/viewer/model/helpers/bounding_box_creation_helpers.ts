import type { Dispatch } from "redux";
import type { Vector3 } from "viewer/constants";
import { getSceneControllerOrNull } from "viewer/controller/scene_controller_provider";
import { dispatchGetNewIdAsync } from "viewer/model/actions/actions";
import { addUserBoundingBoxAction } from "viewer/model/actions/annotation_actions";
import { waitUntilRebaseFinished } from "viewer/model/helpers/rebase_helpers";
import type { UserBoundingBoxWithoutId } from "viewer/store";

// Reserves a bounding box id and adds a new user bounding box, deferring the actual add until any
// active rebase/forwarding has finished if there is such an active operation.
// Used by the explicit "create bounding box" actions (sidebar, toolbar, context menu, shortcut).
// The new box is flashed so that the user can spot where it was created. Boxes drawn with the
// bounding box tool are created elsewhere and don't flash, as the user already sees them.
export async function reserveIdAndAddBoundingBox(
  dispatch: Dispatch<any>,
  tracingId: string,
  newBoundingBox: Partial<UserBoundingBoxWithoutId> | null = null,
  center: Vector3 | undefined = undefined,
): Promise<void> {
  const id = await dispatchGetNewIdAsync(dispatch, tracingId, "BoundingBox");
  await waitUntilRebaseFinished();
  dispatch(addUserBoundingBoxAction(newBoundingBox, center, id));
  // The store listeners run synchronously, so the scene already contains the new box here.
  getSceneControllerOrNull()?.flashUserBoundingBox(id);
}
