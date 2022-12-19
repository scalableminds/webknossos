import { Alert } from "antd";
import ErrorHandling from "libs/error_handling";
import React, { ErrorInfo } from "react";

export default class ErrorBoundary extends React.Component<
  {},
  { error?: Error | null; info?: ErrorInfo | null }
> {
  constructor(props: {}) {
    super(props);
    this.state = {};
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info });
    ErrorHandling.notify(error, { info });
  }

  render() {
    if (this.state.error != null) {
      const { error, info } = this.state;
      const componentStack = info?.componentStack;
      const errorMessage = (error || "").toString();
      const errorDescription = componentStack;

      return (
        <div style={{ margin: 32 }}>
          <h1>webKnossos encountered an error</h1>

          <p>
            Please try reloading the page. The error has been reported to our system and will be
            investigated. If the error persists and/or you need help as soon as possible, feel free
            to{" "}
            <a target="_blank" href="mailto:hello@webknossos.org" rel="noopener noreferrer">
              contact us.
            </a>
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
