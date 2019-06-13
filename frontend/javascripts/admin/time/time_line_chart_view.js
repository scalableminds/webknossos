// @flow
import { Chart } from "react-google-charts";
import * as React from "react";

export type ColumnDefinition = {
  id?: string,
  type: string,
  role?: string,
  p?: Object,
};

export type RowContent = [string, string, string, Date, Date];

export type DateRange = [moment$Moment, moment$Moment];

type Props = {
  columns: Array<ColumnDefinition>,
  rows: Array<RowContent>,
  timeAxisFormat: string,
  dateRange: DateRange,
};

export default class TimeTrackingChart extends React.PureComponent<Props> {
  additionalCSS: ?HTMLStyleElement = null;
  chartScrollElement: ?HTMLElement = null;

  componentWillUnmount() {
    if (this.chartScrollElement) {
      this.chartScrollElement.removeEventListener("mousemove", this.adjustTooltipPosition);
    }
    if (this.additionalCSS) {
      this.additionalCSS.remove();
    }
  }

  // We need to adjust the tooltips position manually because it is not positioned correctly when scrolling down.
  // This fix was suggested by
  // https://stackoverflow.com/questions/52755733/google-charts-tooltips-have-wrong-position-when-inside-a-scrolling-container.

  refreshTooltipPositioningFix = () => {
    this.additionalCSS = document.createElement("style");
    this.additionalCSS.innerHTML = "";
    if (!document.body) {
      return;
    }
    document.body.appendChild(this.additionalCSS);

    // TimeLineGraph is the name of the chart given by the library.
    this.chartScrollElement = document.querySelector(
      "#TimeLineGraph > div > div:first-child > div > div",
    );
    if (this.chartScrollElement) {
      this.chartScrollElement.addEventListener("mousemove", this.adjustTooltipPosition);
    }
  };

  adjustTooltipPosition = (event: MouseEvent) => {
    if (!this.chartScrollElement || !this.additionalCSS) {
      return;
    }
    // When mouse moves, we determine how much the container is scrolled vertically.
    const scrollAmount = this.chartScrollElement.scrollTop;
    this.additionalCSS.innerHTML = `.google-visualization-tooltip {
      top: ${event.offsetY - scrollAmount}px !important;
      left:${event.offsetX + 15}px !important;
    }`;
  };

  render() {
    const { columns, rows, timeAxisFormat, dateRange } = this.props;

    const applyTooltipPositioningFix = this.refreshTooltipPositioningFix;

    return (
      <Chart
        chartType="Timeline"
        columns={columns}
        rows={rows}
        options={{
          timeline: { singleColor: "#108ee9" },
          // Workaround for google-charts bug, see https://github.com/scalableminds/webknossos/pull/3772
          hAxis: {
            format: timeAxisFormat,
            minValue: dateRange[0].toDate(),
            maxValue: dateRange[1].toDate(),
          },
          allowHtml: true,
        }}
        graph_id="TimeLineGraph"
        chartPackages={["timeline"]}
        width="100%"
        height="600px"
        legend_toggle
        chartEvents={[
          {
            eventName: "ready",
            callback() {
              // After the whole chart is draw, we can now apply the position fixing workaround.
              applyTooltipPositioningFix();
            },
          },
        ]}
      />
    );
  }
}
