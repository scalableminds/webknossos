// @flow
import _ from "lodash";
import * as React from "react";
import { Row, Col, Spin, Table, Card } from "antd";
import moment from "moment";
import Request from "libs/request";
import Utils from "libs/utils";
import C3Chart from "react-c3js";

const { Column } = Table;
type TimeEntryType = {
  start: string,
  end: string,
  tracingTime: number,
};

type State = {
  achievements: {
    numberOfUsers: number,
    numberOfDatasets: number,
    numberOfAnnotations: number,
    numberOfTrees: number,
    numberOfOpenAssignments: number,
    tracingTimes: Array<TimeEntryType>,
  },
  timeEntries: Array<TimeEntryType>,
  isAchievementsLoading: boolean,
  isTimeEntriesLoading: boolean,
  startDate: moment$Moment,
  endDate: moment$Moment,
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
      numberOfTrees: 0,
      numberOfOpenAssignments: 0,
      tracingTimes: [],
    },
  };

  componentDidMount() {
    moment.updateLocale("en", { week: { dow: 1 } });

    this.fetchAchievementData();
    this.fetchTimeEntryData();
  }

  toTimestamp(date: moment$Moment) {
    return date.unix() * 1000;
  }

  async fetchAchievementData() {
    const achievementsURL = "/api/statistics/webknossos?interval=week";
    const achievements = await Request.receiveJSON(achievementsURL);

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

  selectDataPoint = (date: { x: string }) => {
    this.setState(
      {
        startDate: moment(date.x),
        endDate: moment(date.x).endOf("week"),
        isTimeEntriesLoading: true,
      },
      () => this.fetchTimeEntryData(),
    );
  };

  render() {
    const previousWeeks = this.state.achievements.tracingTimes.map(item =>
      parseInt(moment.duration(item.tracingTime).asHours()),
    );
    const currentWeek = previousWeeks.length - 1;

    const dates = this.state.achievements.tracingTimes.map(item =>
      moment(item.start).format("YYYY-MM-DD"),
    );

    const listStyle = {
      width: 200,
      display: "inline-block",
    };

    return (
      <div className="statistics container wide">
        <Row gutter={16}>
          <Col span={16}>
            <Card title="Overall Weekly Tracing Time">
              <Spin spinning={this.state.isAchievementsLoading} size="large">
                <C3Chart
                  data={{
                    x: "date",
                    columns: [["date"].concat(dates), ["WeeklyHours"].concat(previousWeeks)],
                    color(color, d) {
                      return d.index === currentWeek ? "#48C561" : color;
                    },
                    selection: {
                      enabled: true,
                      grouped: false,
                      multiple: false,
                    },
                    onclick: this.selectDataPoint,
                  }}
                  axis={{
                    x: {
                      type: "timeseries",
                    },
                    y: {
                      label: "hours / week",
                    },
                  }}
                  legend={{
                    show: false,
                  }}
                />
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
                    <div style={listStyle}>Number of Trees</div>
                    {this.state.achievements.numberOfTrees}
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
              style={{ marginTop: 30, marginBotton: 30 }}
            >
              <Spin spinning={this.state.isTimeEntriesLoading} size="large">
                <Table
                  dataSource={this.state.timeEntries}
                  rowKey={entry => entry.user.id}
                  style={{ marginTop: 30, marginBotton: 30 }}
                  pagination={false}
                >
                  <Column
                    title="User"
                    dataIndex="user"
                    key="user"
                    render={user => `${user.firstName} ${user.lastName} (${user.email})`}
                  />
                  <Column
                    title="Duration"
                    dataIndex="tracingTimes"
                    key="tracingTimes"
                    render={tracingTimes => {
                      const duration = _.sumBy(tracingTimes, timeEntry => timeEntry.tracingTime);
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
