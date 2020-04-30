// @flow
import Maybe from "data.maybe";

import type { APIAnnotation, ServerBoundingBox } from "admin/api_flow_types";
import type { Annotation, BoundingBoxObject } from "oxalis/store";
import type { Boundary } from "oxalis/model/accessors/dataset_accessor";
import type { BoundingBoxType, BoundingBoxWithColorAndId } from "oxalis/constants";
import { V3 } from "libs/mjs";
import * as Utils from "libs/utils";
import { Vector3 } from "three";

export function convertServerBoundingBoxToFrontend(
  boundingBox: ?ServerBoundingBox,
): ?BoundingBoxType {
  return Maybe.fromNullable(boundingBox)
    .map(bb =>
      Utils.computeBoundingBoxFromArray(
        Utils.concatVector3(Utils.point3ToVector3(bb.topLeft), [bb.width, bb.height, bb.depth]),
      ),
    )
    .getOrElse(null);
}

export function convertServerBoundingBoxesToUserBoundingBoxes(
  boundingBoxes: Array<ServerBoundingBox>,
): Array<BoundingBoxWithColorAndId> {
  // The explicit type assignment is needed for flow to understand that the elements of the returned array have an id.
  const bboxesWithColor: Array<BoundingBoxType & { color: Vector3 }> = boundingBoxes.map(bb => ({
    ...Utils.computeBoundingBoxFromArray(
      Utils.concatVector3(Utils.point3ToVector3(bb.topLeft), [bb.width, bb.height, bb.depth]),
    ),
    color: bb.color != null ? bb.color : Utils.getRandomColor(),
  }));
  return Utils.addIdToArrayElements(bboxesWithColor);
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
