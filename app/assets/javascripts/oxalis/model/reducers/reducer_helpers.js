// @flow
/* eslint-disable import/prefer-default-export */
import type { BoundingBoxType } from "oxalis/constants";
import type { APIAnnotationType, ServerBoundingBoxType } from "admin/api_flow_types";
import type { AnnotationType, BoundingBoxObjectType } from "oxalis/store";
import Maybe from "data.maybe";
import * as Utils from "libs/utils";

export function convertServerBoundingBoxToFrontend(
  boundingBox: ?ServerBoundingBoxType,
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
): ?BoundingBoxObjectType {
  return Maybe.fromNullable(boundingBox)
    .map(bb => ({
      topLeft: bb.min,
      width: bb.max[0] - bb.min[0],
      height: bb.max[1] - bb.min[1],
      depth: bb.max[2] - bb.min[2],
    }))
    .getOrElse(null);
}

export function convertPointToVecInBoundingBox(
  boundingBox: ServerBoundingBoxType,
): BoundingBoxObjectType {
  return {
    width: boundingBox.width,
    height: boundingBox.height,
    depth: boundingBox.depth,
    topLeft: Utils.point3ToVector3(boundingBox.topLeft),
  };
}

export function convertServerAnnotationToFrontendAnnotation(
  annotation: APIAnnotationType,
): AnnotationType {
  const { id: annotationId, isPublic, tags, description, name, typ: tracingType } = annotation;
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
    tracingType,
  };
}
