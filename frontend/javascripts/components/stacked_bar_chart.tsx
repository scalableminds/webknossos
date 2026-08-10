import sum from "lodash-es/sum";

// Semantic status colors. Using the antd tokens instead of literals keeps the bars legible in
// the dark theme, where antd darkens/desaturates these hues.
export const colors = {
  finished: "var(--ant-color-success)",
  active: "var(--ant-color-info)",
  open: "var(--ant-color-warning)",
};
const indexToType = ["finished", "active", "open"];

export default function StackedBarChart({ a, b, c }: { a: number; b: number; c: number }) {
  const total = a + b + c;
  const percentages = [a, b, c].map((el) => Math.ceil((el / total) * 100));
  const minPercentage = 10;
  const barCount = 3;
  const bufferFactor = 1 - (barCount * minPercentage) / 100;
  let renderedPercentages = percentages.map((p) =>
    p === 0 ? 0 : Math.max(minPercentage, p * bufferFactor),
  );

  const upscaleFactor = 100 / sum(renderedPercentages);

  renderedPercentages = renderedPercentages.map((p) => p * upscaleFactor);
  return (
    <div
      style={{
        fontSize: 13,
        lineHeight: "14px",
        textAlign: "center",
      }}
    >
      {[a, b, c].map((number, index) => {
        const type = indexToType[index];
        return (
          <div
            key={type}
            style={{
              // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
              background: colors[type],
              minWidth: `${renderedPercentages[index]}%`,
              display: percentages[index] === 0 ? "none" : "inline-block",
              // Text sits on a solid, saturated bar in both themes.
              color: "var(--ant-color-text-light-solid)",
            }}
          >
            {number.toLocaleString()}
          </div>
        );
      })}
    </div>
  );
}
