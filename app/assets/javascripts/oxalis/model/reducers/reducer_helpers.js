// @flow
/* eslint-disable import/prefer-default-export */
import type { BoundingBoxType } from "oxalis/constants";
import type { BoundingBoxObjectType } from "oxalis/store";
import Maybe from "data.maybe";
import Utils from "libs/utils";

export function convertServerBoundingBoxToFrontend(
  boundingBox: ?BoundingBoxObjectType,
): ?BoundingBoxType {
  return Maybe.fromNullable(boundingBox)
    .map(bb =>
      Utils.computeBoundingBoxFromArray(
        Utils.concatVector3(bb.topLeft, [bb.width, bb.height, bb.depth]),
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
