import type React from "react";
import { Suspense, lazy } from "react";

export default function loadable<Props>(
  loader: () => Promise<{ default: React.ComponentType<Props> }>,
) {
  const InternalComponent = lazy(loader) as any;
  return function AsyncComponent(props: Props) {
    return (
      <Suspense fallback={<div style={{ textAlign: "center" }}>Loading...</div>}>
        <InternalComponent {...props} />
      </Suspense>
    );
  };
}
