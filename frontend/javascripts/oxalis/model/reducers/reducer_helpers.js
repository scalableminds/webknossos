// @flow
/* eslint-disable import/prefer-default-export */
import Maybe from "data.maybe";

import type { APIAnnotation, ServerBoundingBox } from "admin/api_flow_types";
import type { Annotation, BoundingBoxObject } from "oxalis/store";
import type { Boundary } from "oxalis/model/accessors/dataset_accessor";
import type { BoundingBoxType } from "oxalis/constants";
import { V3 } from "libs/mjs";
import * as Utils from "libs/utils";

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
    isPublic,
    tags,
    description,
    name,
    typ: annotationType,
    tracingStore,
    meshes,
  } = annotation;
  const restrictions = {
    ...annotation.restrictions,
    ...annotation.settings,
  };
  return {
    annotationId,
    restrictions,
    isPublic,
    tags,
    description,
    name,
    annotationType,
    tracingStore,
    meshes,
  };
}
