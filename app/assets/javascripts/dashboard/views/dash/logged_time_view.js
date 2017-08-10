// @flow

import React from "react";
import moment from "moment";
import FormatUtils from "libs/format_utils";
import Request from "libs/request";
// import c3 from "c3";
import C3Chart from "react-c3js";

function LoggedTimeList({ items }) {
  return (
    <table className="table-striped table-hover table">
      <thead>
        <tr>
          <th>Month</th>
          <th>Worked Hours</th>
        </tr>
      </thead>
      <tbody>
        {items.map(item =>
          <tr key={item.interval}>
            <td>
              {moment(item.interval).format("MM/YYYY")}
            </td>
            <td>
              {FormatUtils.formatSeconds(item.time.asSeconds())}
            </td>
          </tr>,
        )}
      </tbody>
    </table>
  );
}

export default class LoggedTimeView extends React.PureComponent {
  props: {
    userID: ?string,
  };

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
        <div className="row">
          <div className="col-sm-10">
            {this.state.timeEntries.length === 0
              ? <h4>
                  {
                    "Sorry. We don't have any time logs for you. Trace something and come back later"
                  }
                </h4>
              : null}
            {this.renderGraph()}
          </div>
          <div className="col-sm-2">
            <LoggedTimeList items={this.state.timeEntries} />
          </div>
        </div>
      </div>
    );
  }
}
