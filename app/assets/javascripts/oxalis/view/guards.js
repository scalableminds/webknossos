// @flow
import * as React from "react";

import type { Tracing } from "oxalis/store";

export function makeVolumeTracingGuard(Component: any) {
  return function VolumeTracingGuard(props: { volumeTracing: Tracing }) {
    if (props.volumeTracing != null) {
      return <Component {...props} />;
    }
    return null;
  };
}
export function makeSkeletonTracingGuard(Component: any) {
  return function SkeletonTracingGuard(props: { skeletonTracing: Tracing }) {
    if (props.skeletonTracing != null) {
      return <Component {...props} />;
    }
    return null;
  };
}
