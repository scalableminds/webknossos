// @flow
import * as React from "react";

import type { SkeletonTracing, VolumeTracing } from "oxalis/store";

export function makeVolumeTracingGuard(Component: any) {
  return function VolumeTracingGuard(props: { volumeTracing: ?VolumeTracing }) {
    if (props.volumeTracing != null) {
      return <Component {...props} />;
    }
    return null;
  };
}
export function makeSkeletonTracingGuard(Component: any) {
  return function SkeletonTracingGuard(props: { skeletonTracing: ?SkeletonTracing }) {
    if (props.skeletonTracing != null) {
      return <Component {...props} />;
    }
    return null;
  };
}
