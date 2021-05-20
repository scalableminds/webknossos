// @flow
import * as React from "react";

type Props = {
  message?: React.Node,
  isLoading?: boolean,
};

export default function BrainSpinner({ message, isLoading = true }: Props) {
  return (
    <div className="brain-loading">
      <div className="brain-loading-container">
        <div className="brain-loading-content">
          <img
            src="/assets/images/brain.svg"
            alt=""
            style={{
              width: 375,
              height: 299,
              marginLeft: "auto",
              marginRight: "auto",
              marginTop: "10%",
            }}
          />
          {isLoading ? (
            <div
              className="brain-loading-bar"
              style={{ width: "80%", marginLeft: "auto", marginRight: "auto", marginTop: 30 }}
            />
          ) : null}
          {message != null ? (
            <div style={{ marginLeft: "auto", marginRight: "auto", marginTop: 30 }}>{message}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
