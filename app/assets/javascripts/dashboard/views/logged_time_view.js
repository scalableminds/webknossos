// @flow

import * as React from "react";
import moment from "moment";
import { Table, Row, Col } from "antd";
import FormatUtils from "libs/format_utils";
import Request from "libs/request";
import C3Chart from "react-c3js";

const { Column } = Table;

export default class LoggedTimeView extends React.PureComponent<{
  userID: ?string,
}, {
  timeEntries: Array<Object>,
}> {
  state: {
    timeEntries: Array<Object>,
  } = {
    timeEntries: [],
  };

  componentDidMount() {
    this.fetch();
  }

  async fetch(): Promise<void> {
    const url = this.props.userID
      ? `/api/users/${this.props.userID}/loggedTime`
      : "/api/user/loggedTime";

    Request.receiveJSON(url).then(response => {
      const timeEntries = response.loggedTime
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
        {this.state.timeEntries.length === 0
          ? <h4>
              {"Sorry. We don't have any time logs for you. Trace something and come back later."}
            </h4>
          : <div>
              <Row>
                <Col span={18}>
                  {this.renderGraph()}
                </Col>
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
            </div>}
      </div>
    );
  }
}
