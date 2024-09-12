import { Alert } from "antd";
import ErrorHandling from "libs/error_handling";
import React, { type ErrorInfo } from "react";
import type { ArbitraryObject } from "types/globals";

type ErrorBoundaryProps = ArbitraryObject;

export default class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  { error?: Error | null; info?: ErrorInfo | null }
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {};
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info });
    ErrorHandling.notify(error, { info });
  }

  clearLocalStorageAndReload = () => {
    localStorage.clear();
    location.reload();
  };

  render() {
    if (this.state.error != null) {
      const { error, info } = this.state;
      const componentStack = info?.componentStack;
      const errorMessage = (error || "").toString();
      const errorDescription = componentStack;

      return (
        <div style={{ margin: 32 }}>
          <h1>WEBKNOSSOS encountered an error</h1>

          <p>
            Please try reloading the page. The error has been reported to our system and will be
            investigated. If the error persists and/or you need help as soon as possible, feel free
            to{" "}
            <a target="_blank" href="mailto:hello@webknossos.org" rel="noopener noreferrer">
              contact us.
            </a>
          </p>
          <p>
            Clearing the browser's local storage might also help. Click{" "}
            <a href="#" onClick={this.clearLocalStorageAndReload}>
              here
            </a>{" "}
            to do so.
          </p>

          <Alert
            style={{ maxHeight: "70vh", overflow: "auto" }}
            type="error"
            message={errorMessage}
            description={<pre>{errorDescription}</pre>}
          />
        </div>
      );
    }

    return this.props.children;
  }
}
