// @flow

import * as React from "react";
import moment from "moment";
import { Table, Row, Col } from "antd";
import FormatUtils from "libs/format_utils";
import C3Chart from "react-c3js";
import { getLoggedTimes } from "admin/admin_rest_api";

const { Column } = Table;

type Props = {
  userId: ?string,
};

type State = {
  timeEntries: Array<{
    interval: Object,
    time: Object,
    months: number,
  }>,
};

export default class LoggedTimeView extends React.PureComponent<Props, State> {
  state = {
    timeEntries: [],
  };

  componentDidMount() {
    this.fetch();
  }

  async fetch(): Promise<void> {
    const loggedTime = await getLoggedTimes(this.props.userId);

    const timeEntries = loggedTime
      .map(entry => {
        const interval = entry.paymentInterval;
        return {
          interval: moment(`${interval.year} ${interval.month}`, "YYYY MM"),
          time: moment.duration(entry.durationInSeconds, "seconds"),
          months: interval.year * 12 + interval.month,
        };
      })
      .sort((a, b) => b.months - a.months);

    this.setState({
      timeEntries,
    });
  }

  renderGraph = () => {
    // Only render the chart if we have any data.
    const timeEntries = this.state.timeEntries;
    if (timeEntries.length > 0) {
      const dates = timeEntries.map(item => item.interval.toDate());
      const monthlyHours = timeEntries.map(item => item.time.asHours());

      return (
        <C3Chart
          data={{
            x: "date",
            columns: [["date"].concat(dates), ["monthlyHours"].concat(monthlyHours)],
          }}
          axis={{
            x: {
              type: "timeseries",
              tick: {
                format: "%Y %m",
              },
            },
            y: {
              label: "minutes / month",
            },
          }}
          legend={{ show: false }}
        />
      );
    }

    return null;
  };

  render() {
    return (
      <div>
        <h3>Tracked Time</h3>
        {this.state.timeEntries.length === 0 ? (
          <h4>
            {"Sorry. We don't have any time logs for you. Trace something and come back later."}
          </h4>
        ) : (
          <div>
            <Row>
              <Col span={18}>{this.renderGraph()}</Col>
              <Col span={6}>
                <Table dataSource={this.state.timeEntries} rowKey="interval">
                  <Column
                    title="Month"
                    dataIndex="interval"
                    render={interval => moment(interval).format("MM/YYYY")}
                  />
                  <Column
                    title="Worked Hours"
                    dataIndex="time"
                    render={time => FormatUtils.formatSeconds(time.asSeconds())}
                  />
                </Table>
              </Col>
            </Row>
          </div>
        )}
      </div>
    );
  }
}
