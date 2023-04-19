import * as React from "react";
import type { SkeletonTracing } from "oxalis/store";

export function makeSkeletonTracingGuard(Component: any) {
  return function SkeletonTracingGuard(props: {
    skeletonTracing: SkeletonTracing | null | undefined;
  }) {
    if (props.skeletonTracing != null) {
      return <Component {...props} />;
    }

    return null;
  };
}
