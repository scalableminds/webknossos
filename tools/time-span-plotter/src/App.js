import React, { Component } from "react";
import "./App.css";

import spans from "./spans.json";
import updateGroups from "./updates.json";

class App extends Component {
  render() {
    const smallest = 1509437505073;
    const factor = 1000.0;
    return (
      <div className="App">
        <svg className="App-svg">
          {updateGroups.map(group => {
            const color = group.annotationId.substr(group.annotationId.length - 6);

            return group.timestamps.map(timestamp => (
              <line
                className="update"
                style={{ stroke: `#${color}` }}
                x1={(timestamp - smallest) / factor}
                x2={(timestamp - smallest) / factor}
                y1={0}
                y2={1000}
              >
                <title>{new Date(timestamp).toString()}</title>
              </line>
            ));
          })}
          {spans.map((span, idx) => {
            const color = span.annotation.substr(span.annotation.length - 6);
            return (
              <rect
                className="span"
                style={{ fill: `#${color}` }}
                x={(span.timestamp - smallest) / factor}
                width={(span.lastUpdate - span.timestamp) / factor}
                y={idx * 3}
                height={5}
              >
                <title>{(span.lastUpdate - span.timestamp) / 1000.0}</title>
              </rect>
            );
          })}
        </svg>
      </div>
    );
  }
}

export default App;
