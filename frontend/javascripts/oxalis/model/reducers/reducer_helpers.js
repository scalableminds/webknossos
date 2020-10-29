// @flow
import Maybe from "data.maybe";

import type {
  APIAnnotation,
  ServerBoundingBox,
  UserBoundingBoxFromServer,
} from "types/api_flow_types";
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

export function convertServerBoundingBoxToBoundingBox(
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
    .map(bb => convertServerBoundingBoxToBoundingBox(bb))
    .getOrElse(null);
}

export function convertUserBoundingBoxesFromServerToFrontend(
  boundingBoxes: Array<UserBoundingBoxFromServer>,
): Array<UserBoundingBox> {
  return boundingBoxes.map(bb => {
    const { color, id, name, isVisible, boundingBox } = bb;
    const convertedBoundingBox = convertServerBoundingBoxToBoundingBox(boundingBox);
    return {
      boundingBox: convertedBoundingBox,
      color: color ? Utils.colorObjectToRGBArray(color) : Utils.getRandomColor(),
      id,
      name: name || `user bounding box ${id}`,
      isVisible: isVisible != null ? isVisible : true,
    };
  });
}

export function convertUserBoundingBoxesFromFrontendToServer(
  boundingBoxes: Array<UserBoundingBox>,
): Array<UserBoundingBoxToServer> {
  // The exact spreading is needed for flow to grasp that the conversion is correct.
  return boundingBoxes.map(bb => {
    const { boundingBox, ...rest } = bb;
    return {
      ...rest,
      boundingBox: Utils.computeBoundingBoxObjectFromBoundingBox(boundingBox),
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
