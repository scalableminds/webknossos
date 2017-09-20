// @flow
/* eslint-disable import/prefer-default-export */
import type { BoundingBoxType } from "oxalis/constants";
import type { BoundingBoxObjectType } from "oxalis/store";
import Maybe from "data.maybe";
import Utils from "libs/utils";

export function convertBoundingBox(boundingBox: ?BoundingBoxObjectType): ?BoundingBoxType {
  return Maybe.fromNullable(boundingBox)
    .map(bb => {
      if (_.isArray(bb.topLeft)) {
        return Utils.computeBoundingBoxFromArray(
          Utils.concatVector3(bb.topLeft, [bb.width, bb.height, bb.depth]),
        );
      } else {
        return Utils.computeBoundingBoxFromArray([
          bb.topLeft.x,
          bb.topLeft.y,
          bb.topLeft.z,
          bb.width,
          bb.height,
          bb.depth,
        ]);
      }
    })
    .getOrElse(null);
}
