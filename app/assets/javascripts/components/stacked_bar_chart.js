// @flow
import _ from "lodash";
import * as React from "react";

export const colors = {
  finished: "#52c41a",
  active: "#1890ff",
  open: "#f5f5f5",
  openFG: "rgba(0, 0, 0, .7)",
};
const indexToType = ["finished", "active", "open"];

export default function StackedBarChart({ a, b, c }: { a: number, b: number, c: number }) {
  const total = a + b + c;
  const percentages = [a, b, c].map(el => Math.ceil((el / total) * 100));

  const minPercentage = 10;
  const barCount = 3;
  const bufferFactor = 1 - (barCount * minPercentage) / 100;
  let renderedPercentages = percentages.map(
    p => (p === 0 ? 0 : Math.max(minPercentage, p * bufferFactor)),
  );
  const upscaleFactor = 100 / _.sum(renderedPercentages);
  renderedPercentages = renderedPercentages.map(p => p * upscaleFactor);

  return (
    <div style={{ fontSize: 13, lineHeight: "14px", textAlign: "center" }}>
      {[a, b, c].map((number, index) => {
        const type = indexToType[index];
        return (
          <div
            key={type}
            style={{
              background: colors[type],
              minWidth: `${renderedPercentages[index]}%`,
              display: percentages[index] === 0 ? "none" : "inline-block",
              color: index < 2 ? "#ffffff" : colors.openFG,
            }}
          >
            {number.toLocaleString()}
          </div>
        );
      })}
    </div>
  );
}
