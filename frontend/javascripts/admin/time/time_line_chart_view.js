// @flow
import { Chart } from "react-google-charts";
import * as React from "react";
import { getWindowBounds } from "libs/utils";

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
    const { chartScrollElement } = this;
    if (chartScrollElement) {
      chartScrollElement.removeEventListener("mousemove", this.adjustTooltipPosition);
    }
  }

  /* We need to adjust the tooltips position manually because it is not positioned correctly when scrolling down.
   * This fix was suggested by
   * https://stackoverflow.com/questions/52755733/google-charts-tooltips-have-wrong-position-when-inside-a-scrolling-container.
   * The fix is modified so that it sets the tooltip directly next to the mouse. This is done by using the total
   * coordinates of the mouse of the whole window (clientX/Y) and manipulating the style of the tooltip directly. */
  applyTooltipPositioningFix = () => {
    // TimeLineGraph is the name of the chart given by the library.
    const chartScrollElement = document.querySelector(
      "#TimeLineGraph > div > div:first-child > div",
    );
    if (chartScrollElement) {
      chartScrollElement.addEventListener("mousemove", this.adjustTooltipPosition);
    }
    this.chartScrollElement = chartScrollElement;
  };

  adjustTooltipPosition = (event: MouseEvent) => {
    const tooltip = document.getElementsByClassName("google-visualization-tooltip")[0];
    if (tooltip != null) {
      const { target } = event;
      const isTargetNotATimeEntry =
        // $FlowIssue[prop-missing]
        (target != null && target.tagName != null && target.tagName !== "rect") ||
        // $FlowIssue[prop-missing]
        target.getAttribute("stroke") !== "none";
      if (isTargetNotATimeEntry) {
        if (tooltip.parentElement) {
          tooltip.parentElement.removeChild(tooltip);
        }
        return;
      }

      const { clientX, clientY } = event;
      const [clientWidth, clientHeight] = getWindowBounds();
      const { offsetHeight, offsetWidth } = tooltip;
      if (clientY + offsetHeight >= clientHeight) {
        // The tooltip needs to be displayed above the mouse.
        tooltip.style.top = `${clientY - offsetHeight}px`;
      } else {
        // The tooltip can be displayed below the mouse.
        tooltip.style.top = `${clientY}px`;
      }
      if (clientX + offsetWidth >= clientWidth) {
        // The tooltip needs to be displayed on the left side of the mouse.
        tooltip.style.left = `${clientX - offsetWidth - 5}px`;
      } else {
        // The tooltip needs to be displayed on the right side of the mouse.
        tooltip.style.left = `${clientX + 15}px`;
      }
      // We need to make the tooltip visible again after adjusting the position.
      // It is initially invisible as it is mispositioned by the library and would then "beam" to the corrected
      // position. We want to avoid that "beaming" behaviour.
      tooltip.style.visibility = "visible";
    }
  };

  render() {
    const { columns, rows, timeAxisFormat, dateRange } = this.props;

    const { applyTooltipPositioningFix } = this;

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
              // After the whole chart is drawn, we can now apply the position fixing workaround.
              applyTooltipPositioningFix();
            },
          },
        ]}
      />
    );
  }
}
