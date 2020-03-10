// @flow
import * as React from "react";

export default function BrainSpinner() {
  return (
    <div className="cover-whole-screen">
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
