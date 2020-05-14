// @flow
import Maybe from "data.maybe";

import type { APIAnnotation, ServerBoundingBox, ServerUserBoundingBox } from "admin/api_flow_types";
import type {
  Annotation,
  BoundingBoxObject,
  UserBoundingBox,
  UserBoundingBoxToServer,
} from "oxalis/store";
import type { Boundary } from "oxalis/model/accessors/dataset_accessor";
import type { BoundingBoxType } from "oxalis/constants";
import { V3 } from "libs/mjs";
import * as Utils from "libs/utils";

function convertServerBoundingBoxToMinMaxBoundingBox(
  boundingBox: ServerBoundingBox,
): BoundingBoxType {
  return Utils.computeBoundingBoxFromArray(
    Utils.concatVector3(Utils.point3ToVector3(boundingBox.topLeft), [
      boundingBox.width,
      boundingBox.height,
      boundingBox.depth,
    ]),
  );
}

export function convertServerBoundingBoxToFrontend(
  boundingBox: ?ServerBoundingBox,
): ?BoundingBoxType {
  return Maybe.fromNullable(boundingBox)
    .map(bb => convertServerBoundingBoxToMinMaxBoundingBox(bb))
    .getOrElse(null);
}

export const addNewUserBoundingBoxToArray = (
  userBoundingBoxes: Array<UserBoundingBox>,
  newBounds: BoundingBoxType,
) => {
  // We use the default of -1 to get the id 0 for the first user bounding box.
  const highestBoundingBoxId = Math.max(-1, ...userBoundingBoxes.map(bb => bb.id));
  const boundingBoxId = highestBoundingBoxId + 1;
  const newUserBoundingBox = {
    boundingBox: newBounds,
    id: boundingBoxId,
    name: `user bounding box ${boundingBoxId}`,
    color: Utils.getRandomColor(),
    isVisible: true,
  };
  return [...userBoundingBoxes, newUserBoundingBox];
};

export function convertUserBoundingBoxesFromServerToFrontend(
  boundingBoxes: Array<ServerUserBoundingBox>,
  oldUserBoundingBox: ?ServerBoundingBox,
): Array<UserBoundingBox> {
  let userBoundingBoxes = boundingBoxes.map(bb => {
    const { color, id, name, isVisible, boundingBox } = bb;
    const convertedBoundingBox = convertServerBoundingBoxToMinMaxBoundingBox(boundingBox);
    return {
      boundingBox: convertedBoundingBox,
      color: color ? Utils.colorObjectToRGBArray(color) : Utils.getRandomColor(),
      id,
      name: name || `UserBoundingBox_${id}`,
      isVisible: isVisible != null ? isVisible : true,
    };
  });
  const maybeConvertedBoundingBox = convertServerBoundingBoxToFrontend(oldUserBoundingBox);
  if (maybeConvertedBoundingBox) {
    userBoundingBoxes = addNewUserBoundingBoxToArray(userBoundingBoxes, maybeConvertedBoundingBox);
  }
  return userBoundingBoxes;
}

export function convertUserBoundingBoxesFromFrontendToServer(
  boundingBoxes: Array<UserBoundingBox>,
): Array<UserBoundingBoxToServer> {
  // The exact spreading is needed for flow to grasp that the conversion is correct.
  return boundingBoxes.map(bb => {
    const { id, boundingBox, name, color, isVisible } = bb;
    return {
      id,
      name,
      color,
      isVisible,
      boundingBox: Utils.computeBoundingBoxObjectFromBoundingBoxType(boundingBox),
    };
  });
}

export function convertFrontendBoundingBoxToServer(
  boundingBox: ?BoundingBoxType,
): ?BoundingBoxObject {
  return Maybe.fromNullable(boundingBox)
    .map(bb => ({
      topLeft: bb.min,
      width: bb.max[0] - bb.min[0],
      height: bb.max[1] - bb.min[1],
      depth: bb.max[2] - bb.min[2],
    }))
    .getOrElse(null);
}

export function convertBoundariesToBoundingBox(boundary: Boundary): BoundingBoxObject {
  const [width, height, depth] = V3.sub(boundary.upperBoundary, boundary.lowerBoundary);
  return {
    width,
    height,
    depth,
    topLeft: boundary.lowerBoundary,
  };
}

// Currently unused.
export function convertPointToVecInBoundingBox(boundingBox: ServerBoundingBox): BoundingBoxObject {
  return {
    width: boundingBox.width,
    height: boundingBox.height,
    depth: boundingBox.depth,
    topLeft: Utils.point3ToVector3(boundingBox.topLeft),
  };
}

export function convertServerAnnotationToFrontendAnnotation(annotation: APIAnnotation): Annotation {
  const {
    id: annotationId,
    visibility,
    tags,
    description,
    name,
    typ: annotationType,
    tracingStore,
    meshes,
    user,
  } = annotation;
  const restrictions = {
    ...annotation.restrictions,
    ...annotation.settings,
  };
  return {
    annotationId,
    restrictions,
    visibility,
    tags,
    description,
    name,
    annotationType,
    tracingStore,
    meshes,
    user,
  };
}
