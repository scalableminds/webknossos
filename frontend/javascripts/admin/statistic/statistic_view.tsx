// @flow
import { Chart } from "react-google-charts";
import { Row, Col, Spin, Table, Card } from "antd";
import * as React from "react";
import _ from "lodash";
import moment from "moment";
import Request from "libs/request";
import * as Utils from "libs/utils";
const { Column } = Table;
type TimeEntry = {
  start: string;
  end: string;
  tracingTime: number;
};
type State = {
  achievements: {
    numberOfUsers: number;
    numberOfDatasets: number;
    numberOfAnnotations: number;
    numberOfOpenAssignments: number;
    tracingTimes: Array<TimeEntry>;
  };
  timeEntries: Array<TimeEntry>;
  isAchievementsLoading: boolean;
  isTimeEntriesLoading: boolean;
  // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'moment$Moment'.
  startDate: moment$Moment;
  // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'moment$Moment'.
  endDate: moment$Moment;
};
type GoogleCharts = {
  chartWrapper: {
    getChart: () => {
      getSelection: (...args: Array<any>) => any;
    };
  }; // https://developers.google.com/chart/interactive/docs/drawing_charts#chartwrapper
};

class StatisticView extends React.PureComponent<{}, State> {
  state = {
    isAchievementsLoading: true,
    isTimeEntriesLoading: true,
    startDate: moment().startOf("week"),
    endDate: moment().endOf("week"),
    timeEntries: [],
    achievements: {
      numberOfUsers: 0,
      numberOfDatasets: 0,
      numberOfAnnotations: 0,
      numberOfOpenAssignments: 0,
      tracingTimes: [],
    },
  };

  componentDidMount() {
    moment.updateLocale("en", {
      week: {
        dow: 1,
      },
    });
    this.fetchAchievementData();
    this.fetchTimeEntryData();
  }

  // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'moment$Moment'.
  toTimestamp(date: moment$Moment) {
    return date.unix() * 1000;
  }

  async fetchAchievementData() {
    const achievementsURL = "/api/statistics/webknossos?interval=week";
    const achievements = await Request.receiveJSON(achievementsURL);
    achievements.tracingTimes.sort(
      // @ts-expect-error ts-migrate(7031) FIXME: Binding element 'dateString1' implicitly has an 'a... Remove this comment to see the full error message
      ({ start: dateString1 }, { start: dateString2 }) =>
        // @ts-expect-error ts-migrate(2362) FIXME: The left-hand side of an arithmetic operation must... Remove this comment to see the full error message
        new Date(dateString2) - new Date(dateString1),
    );
    this.setState({
      isAchievementsLoading: false,
      achievements,
    });
  }

  async fetchTimeEntryData() {
    const timeEntriesURL = `/api/statistics/users?interval=week&start=${this.toTimestamp(
      this.state.startDate,
    )}&end=${this.toTimestamp(this.state.endDate)}&limit=5`;
    const timeEntries = await Request.receiveJSON(timeEntriesURL);
    this.setState({
      isTimeEntriesLoading: false,
      timeEntries,
    });
  }

  selectDataPoint = ({ chartWrapper }: GoogleCharts) => {
    const chart = chartWrapper.getChart();
    const indicies = chart.getSelection()[0];
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'start' does not exist on type 'never'.
    const startDate = this.state.achievements.tracingTimes[indicies.row].start;
    this.setState(
      {
        startDate: moment(startDate),
        endDate: moment(startDate).endOf("week"),
        isTimeEntriesLoading: true,
      },
      () => this.fetchTimeEntryData(),
    );
  };

  render() {
    const columns = [
      {
        id: "Date",
        type: "date",
      },
      {
        id: "HoursPerWeek",
        type: "number",
      },
      {
        id: "Tooltip",
        type: "string",
        role: "tooltip",
      },
    ];
    const rows = this.state.achievements.tracingTimes.map((item) => {
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'tracingTime' does not exist on type 'nev... Remove this comment to see the full error message
      const duration = Utils.roundTo(moment.duration(item.tracingTime).asHours(), 2);
      return [
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'start' does not exist on type 'never'.
        new Date(item.start),
        duration,
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'start' does not exist on type 'never'.
        `${moment(item.start).format("DD.MM.YYYY")} - ${moment(item.end).format("DD.MM.YYYY")}
        ${duration}h`,
      ];
    });
    const listStyle = {
      width: 200,
      display: "inline-block",
    };
    return (
      <div className="statistics container">
        <Row gutter={16}>
          <Col span={16}>
            <Card title="Overall Weekly Annotation Time">
              <Spin spinning={this.state.isAchievementsLoading} size="large">
                {rows.length > 0 ? (
                  // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
                  <Chart
                    chartType="LineChart"
                    columns={columns}
                    rows={rows}
                    graph_id="TimeGraph"
                    width="100%"
                    height="400px"
                    chartEvents={[
                      {
                        eventName: "select",
                        callback: this.selectDataPoint,
                      },
                    ]}
                    options={{
                      pointSize: 5,
                      legend: {
                        position: "none",
                      },
                      hAxis: {
                        title: "",
                        minorGridlines: {
                          color: "none",
                        },
                      },
                      vAxis: {
                        title: "Hours / Week",
                        minorGridlines: {
                          color: "none",
                        },
                        viewWindowMode: "explicit",
                        viewWindow: {
                          min: 0,
                        },
                      },
                    }}
                  />
                ) : null}
              </Spin>
            </Card>
          </Col>
          <Col span={8}>
            <Card title="Achievements">
              <Spin spinning={this.state.isAchievementsLoading} size="large">
                <ul>
                  <li>
                    <div style={listStyle}>Number of Users</div>
                    {this.state.achievements.numberOfUsers}
                  </li>
                  <li>
                    <div style={listStyle}>Number of Datasets</div>
                    {this.state.achievements.numberOfDatasets}
                  </li>
                  <li>
                    <div style={listStyle}>Number of Annotations</div>
                    {this.state.achievements.numberOfAnnotations}
                  </li>
                  <li>
                    <div style={listStyle}>Number of Open Assignments</div>
                    {this.state.achievements.numberOfOpenAssignments}
                  </li>
                </ul>
              </Spin>
            </Card>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={24}>
            <Card
              title={`Best Tracers for Week ${this.state.startDate.format(
                "DD.MM",
              )} - ${this.state.endDate.format("DD.MM.YYYY")}`}
              style={{
                marginTop: 30,
                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ marginTop: number; marginBotton: number; }... Remove this comment to see the full error message
                marginBotton: 30,
              }}
            >
              <Spin spinning={this.state.isTimeEntriesLoading} size="large">
                <Table
                  dataSource={this.state.timeEntries}
                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'user' does not exist on type 'never'.
                  rowKey={(entry) => entry.user.id}
                  style={{
                    marginTop: 30,
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ marginTop: number; marginBotton: number; }... Remove this comment to see the full error message
                    marginBotton: 30,
                  }}
                  pagination={false}
                >
                  <Column
                    title="User"
                    dataIndex="user"
                    key="user"
                    render={(user) => `${user.lastName}, ${user.firstName} (${user.email})`}
                  />
                  <Column
                    title="Duration"
                    dataIndex="tracingTimes"
                    key="tracingTimes"
                    render={(tracingTimes) => {
                      // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                      const duration = _.sumBy(tracingTimes, (timeEntry) => timeEntry.tracingTime);

                      const minutes = duration / 1000 / 60;
                      const hours = Utils.zeroPad(Math.floor(minutes / 60));
                      const remainingMinutes = Utils.zeroPad(Math.floor(minutes % 60));
                      return `${hours}h ${remainingMinutes}m`;
                    }}
                  />
                </Table>
              </Spin>
            </Card>
          </Col>
        </Row>
      </div>
    );
  }
}

export default StatisticView;
