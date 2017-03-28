// @flow
import React from "react";

export function makeVolumeTracingGuard(component) {
  return function VolumeTracingGuard(props) {
    if (props.tracing.type === "volume") {
      return <component {...props} />;
    }
    return null;
  };
}
export function makeSkeletonTracingGuard(component) {
  return function SkeletonTracingGuard(props) {
    if (props.tracing.type === "skeleton") {
      return <component {...props} />;
    }
    return null;
  };
}
