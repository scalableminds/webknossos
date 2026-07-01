import { Button, Result } from "antd";
import importDynamic from "libs/import_dynamic";
import window from "libs/window";
import type React from "react";
import { lazy, Suspense } from "react";

function DefaultErrorComponent() {
  return (
    <Result
      status="warning"
      title="This part of WEBKNOSSOS could not be loaded."
      subTitle="Most likely, a new version of WEBKNOSSOS was released or there is a problem with your network connection. Please reload the page."
      extra={
        <Button type="primary" onClick={() => window.location.reload()}>
          Reload Page
        </Button>
      }
    />
  );
}

export default function loadable<Props>(
  loader: () => Promise<{ default: React.ComponentType<Props> }>,
  // Is rendered (with the same props) in case the component cannot be loaded,
  // for example, because a new WEBKNOSSOS version was deployed in the meantime.
  ErrorComponent: React.ComponentType<Props> = DefaultErrorComponent,
) {
  const InternalComponent = lazy(() =>
    // Don't show the error toast since the rendered ErrorComponent
    // already informs the user about the problem.
    importDynamic(loader, { showErrorToast: false }).catch(() => ({
      default: ErrorComponent,
    })),
  ) as any;
  return function AsyncComponent(props: Props) {
    return (
      <Suspense fallback={<div style={{ textAlign: "center" }}>Loading...</div>}>
        <InternalComponent {...props} />
      </Suspense>
    );
  };
}
