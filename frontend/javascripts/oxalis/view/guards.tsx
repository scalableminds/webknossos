import type { SkeletonTracing } from "oxalis/store";
import * as React from "react";

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
