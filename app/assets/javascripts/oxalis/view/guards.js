// @flow
import * as React from "react";
import type { TracingType } from "oxalis/store";

export function makeVolumeTracingGuard(Component: any) {
  return function VolumeTracingGuard(props: { volumeTracing: TracingType }) {
    if (props.volumeTracing.type === "volume") {
      return <Component {...props} />;
    }
    return null;
  };
}
export function makeSkeletonTracingGuard(Component: any) {
  return function SkeletonTracingGuard(props: { skeletonTracing: TracingType }) {
    if (props.skeletonTracing.type === "skeleton") {
      return <Component {...props} />;
    }
    return null;
  };
}
