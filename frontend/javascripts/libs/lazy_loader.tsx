import * as React from "react";

export default function loadable<Props>(
  loader: () => Promise<{ default: React.ComponentType<Props> }>,
) {
  const InternalComponent = React.lazy(loader) as any;
  return function AsyncComponent(props: Props) {
    return (
      <React.Suspense fallback={<div style={{ textAlign: "center" }}>Loading...</div>}>
        <InternalComponent {...props} />
      </React.Suspense>
    );
  };
}
