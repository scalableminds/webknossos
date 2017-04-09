// @flow
import React from "react";
import type { TracingType } from "oxalis/store";

export function makeVolumeTracingGuard(component: any) {
  return function VolumeTracingGuard(props: { tracing: TracingType }) {
    if (props.tracing.type === "volume") {
      return <component {...props} />;
    }
    return null;
  };
}
export function makeSkeletonTracingGuard(component: any) {
  return function SkeletonTracingGuard(props: { tracing: TracingType }) {
    if (props.tracing.type === "skeleton") {
      return <component {...props} />;
    }
    return null;
  };
}
