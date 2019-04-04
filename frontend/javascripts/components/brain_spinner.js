// @flow
import * as React from "react";

export default function BrainSpinner() {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        background: "rgb(252, 252, 252)",
        zIndex: 300,
      }}
    >
      <div className="Aligner" style={{ height: "80%" }}>
        <div className="Aligner-item Aligner-item--fixed">
          <div style={{ width: 375 }}>
            <img
              src="/assets/images/brain.png"
              alt=""
              style={{
                width: 375,
                height: 299,
                marginLeft: "auto",
                marginRight: "auto",
                marginTop: "10%",
              }}
            />
            <div
              className="loader"
              style={{ width: "80%", marginLeft: "auto", marginRight: "auto", marginTop: 30 }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
