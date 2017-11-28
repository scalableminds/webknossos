// @flow
import _ from "lodash";
import * as React from "react";
import moment from "moment";
import { Select, Card, Form, Row, Col, DatePicker } from "antd";
import { Chart } from "react-google-charts";
import FormatUtils from "libs/format_utils";
import { getUsers, getTimeTrackingForUserByMonth } from "admin/admin_rest_api";

import type { APIUserType, APITimeTrackingType } from "admin/api_flow_types";

const FormItem = Form.Item;
const Option = Select.Option;

type TimeTrackingStatsType = {
  totalMonthlyTime: number,
  totalDailyTime: number,
  numberMonthlyTasks: number,
  numberDailyTasks: number,
  averageTimePerTask: number,
};

type State = {
  user: ?APIUserType,
  users: Array<APIUserType>,
  date: moment$Moment,
  timeTrackingDataMonth: Array<APITimeTrackingType>,
  timeTrackingDataDay: Array<APITimeTrackingType>,
  stats: TimeTrackingStatsType,
};

class TimeLineView extends React.PureComponent<*, State> {
  state = {
    user: null,
    users: [],
    date: moment(),
    timeTrackingDataMonth: [],
    timeTrackingDataDay: [],
    stats: {
      totalMonthlyTime: 0,
      totalDailyTime: 0,
      numberMonthlyTasks: 0,
      numberDailyTasks: 0,
      averageTimePerTask: 0,
    },
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    const users = await getUsers();
    this.setState({ users });
  }

  async fetchTimeTrackingData() {
    if (this.state.user != null) {
      const timeTrackingDataMonth = await getTimeTrackingForUserByMonth(
        this.state.user.email,
        this.state.date,
      );

      const timeTrackingDataDay = timeTrackingDataMonth.filter(t =>
        moment(t.timestamp).isSame(this.state.date, "day"),
      );

      this.setState(
        {
          timeTrackingDataMonth,
          timeTrackingDataDay,
        },
        this.calculateStats,
      );
    }
  }

  calculateStats() {
    const totalMonthlyTime = _.sumBy(this.state.timeTrackingDataMonth, timeSpan =>
      moment.duration(timeSpan.time).asMilliseconds(),
    );
    const numberMonthlyTasks = _.uniq(
      this.state.timeTrackingDataMonth.map(timeSpan => timeSpan.annotation),
    ).length;
    const averageTimePerTask = totalMonthlyTime / numberMonthlyTasks;

    const totalDailyTime = _.sumBy(this.state.timeTrackingDataDay, timeSpan =>
      moment.duration(timeSpan.time).asMilliseconds(),
    );
    const numberDailyTasks = _.uniq(
      this.state.timeTrackingDataDay.map(timeSpan => timeSpan.annotation),
    ).length;

    this.setState({
      stats: {
        totalMonthlyTime,
        numberMonthlyTasks,
        totalDailyTime,
        numberDailyTasks,
        averageTimePerTask,
      },
    });
  }

  handleUserChange = async (userId: number) => {
    const user = this.state.users.find(u => u.id === userId);
    await this.setState({ user });
    this.fetchTimeTrackingData();
  };

  handleDateChange = async (date: moment$Moment) => {
    await this.setState({ date });
    this.fetchTimeTrackingData();
  };

  render() {
    const columns = [
      { id: "AnnotationId", type: "string" },
      { id: "Start", type: "date" },
      { id: "End", type: "date" },
    ];

    const timeTrackingRowGrouped = []; // shows each time span grouped by annotation id
    const timeTrackingRowTotal = []; // show all times spans in a single row

    this.state.timeTrackingDataDay.forEach((datum: APITimeTrackingType) => {
      const duration = moment.duration(datum.time).asMilliseconds();
      const start = new Date(datum.timestamp);
      const end = new Date(datum.timestamp + duration);

      timeTrackingRowGrouped.push([datum.annotation, start, end]);
      timeTrackingRowTotal.push(["Sum Tracking Time", start, end]);
    });

    const rows = timeTrackingRowTotal.concat(timeTrackingRowGrouped);

    const formItemLayout = {
      labelCol: { span: 5 },
      wrapperCol: { span: 19 },
    };

    const paddingBottom = {
      paddingBottom: 5,
    };

    return (
      <div className="container wide">
        <Card title={<h4>Time Tracking </h4>}>
          <p>
            The time tracking information display here only includes data acquired when working on
            &quot;tasks&quot;.
          </p>
          <hr />
          <Row gutter={40}>
            <Col span={12}>
              <FormItem {...formItemLayout} label="User">
                <Select
                  allowClear
                  showSearch
                  placeholder="Select a User"
                  optionFilterProp="children"
                  style={{ width: "100%" }}
                  onChange={this.handleUserChange}
                >
                  {this.state.users.filter(u => u.isActive).map((user: APIUserType) => (
                    <Option key={user.id} value={user.id}>
                      {`${user.lastName}, ${user.firstName} ${user.email}`}
                    </Option>
                  ))}
                </Select>
              </FormItem>
              <FormItem {...formItemLayout} label="Date">
                <DatePicker
                  allowClear={false}
                  style={{ width: "100%" }}
                  value={moment(this.state.date)}
                  onChange={this.handleDateChange}
                />
              </FormItem>
            </Col>
            <Col span={12}>
              <Row>
                <Col span={8}>
                  <ul>
                    <li>Total Time {this.state.date.format("MMMM YYYY")}:</li>
                    <li style={paddingBottom}># Monthly Tasks:</li>
                    <li>Total Time {this.state.date.format("MM/DD/YYYY")}:</li>
                    <li style={paddingBottom}># Task {this.state.date.format("MM/DD/YYYY")}:</li>
                    <li>Average Time per Task:</li>
                  </ul>
                </Col>
                <Col span={16}>
                  <ul>
                    <li>{FormatUtils.formatMilliseconds(this.state.stats.totalMonthlyTime)}</li>
                    <li style={paddingBottom}>{this.state.stats.numberMonthlyTasks}</li>
                    <li>{FormatUtils.formatMilliseconds(this.state.stats.totalDailyTime)}</li>
                    <li style={paddingBottom}>{this.state.stats.numberDailyTasks}</li>
                    <li>{FormatUtils.formatMilliseconds(this.state.stats.averageTimePerTask)}</li>
                  </ul>
                </Col>
              </Row>
            </Col>
          </Row>
        </Card>

        <div style={{ marginTop: 20 }}>
          {this.state.timeTrackingDataDay.length > 0 ? (
            <Chart
              chartType="Timeline"
              columns={columns}
              rows={rows}
              graph_id="TimeLineGraph"
              chartPackages={["timeline"]}
              width="100%"
              height="600px"
              legend_toggle
            />
          ) : (
            <div style={{ textAlign: "center" }}>
              No Time Tracking Data for the Selected User or Day.
            </div>
          )}
        </div>
      </div>
    );
  }
}

export default TimeLineView;
