// @flow
import _ from "lodash";
import * as React from "react";
import moment from "moment";
import { Select, Card, Form, Row, Col, DatePicker } from "antd";
import { Chart } from "react-google-charts";
import FormatUtils from "libs/format_utils";
import { getUsers, getTimeTrackingForUser } from "admin/admin_rest_api";

import type { APIUserType, APITimeTrackingType } from "admin/api_flow_types";

const FormItem = Form.Item;
const Option = Select.Option;
const RangePicker = DatePicker.RangePicker;

type TimeTrackingStatsType = {
  totalTime: number,
  numberTasks: number,
  averageTimePerTask: number,
};

type DateRangeType = [moment$Moment, moment$Moment];

type State = {
  user: ?APIUserType,
  users: Array<APIUserType>,
  dateRange: DateRangeType,
  timeTrackingDataMonth: Array<APITimeTrackingType>,
  timeTrackingDataDay: Array<APITimeTrackingType>,
  stats: TimeTrackingStatsType,
};

class TimeLineView extends React.PureComponent<*, State> {
  state = {
    user: null,
    users: [],
    dateRange: [moment().startOf("day"), moment().endOf("day")],
    timeTrackingDataMonth: [],
    timeTrackingDataDay: [],
    stats: {
      totalTime: 0,
      numberTasks: 0,
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
      const timeTrackingDataMonth = await getTimeTrackingForUser(
        this.state.user.id,
        this.state.dateRange[0],
        this.state.dateRange[1],
      );

      const timeTrackingDataDay = timeTrackingDataMonth.filter(t =>
        moment(t.timestamp).isBetween(...this.state.dateRange),
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
    const totalTime = _.sumBy(this.state.timeTrackingDataDay, timeSpan =>
      moment.duration(timeSpan.time).asMilliseconds(),
    );
    const numberTasks = _.uniq(this.state.timeTrackingDataDay.map(timeSpan => timeSpan.annotation))
      .length;

    const averageTimePerTask = totalTime / numberTasks;

    this.setState({
      stats: {
        totalTime,
        numberTasks,
        averageTimePerTask,
      },
    });
  }

  handleUserChange = async (userId: number) => {
    const user = this.state.users.find(u => u.id === userId);
    await this.setState({ user });
    this.fetchTimeTrackingData();
  };

  handleDateChange = async (dates: DateRangeType) => {
    // for same day use start and end timestamps
    const dateRange = dates[0].isSame(dates[1], "day")
      ? [dates[0].startOf("day"), dates[1].endOf("day")]
      : dates;

    await this.setState({ dateRange });
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
                <RangePicker
                  allowClear={false}
                  style={{ width: "100%" }}
                  value={this.state.dateRange}
                  onChange={this.handleDateChange}
                />
              </FormItem>
            </Col>
            <Col span={12}>
              <Row>
                <Col span={8}>
                  <ul>
                    <li style={paddingBottom}>Total Time:</li>
                    <li style={paddingBottom}>Number of Tasks:</li>
                    <li>Average Time per Task:</li>
                  </ul>
                </Col>
                <Col span={16}>
                  <ul>
                    <li>{FormatUtils.formatMilliseconds(this.state.stats.totalTime)}</li>
                    <li style={paddingBottom}>{this.state.stats.numberTasks}</li>
                    <li>{FormatUtils.formatMilliseconds(this.state.stats.averageTimePerTask)}</li>
                  </ul>
                </Col>
              </Row>
              The time tracking information display here only includes data acquired when working on
              &quot;tasks&quot; and not explorative tracings.
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
              No Time Tracking Data for the Selected User or Date Range.
            </div>
          )}
        </div>
      </div>
    );
  }
}

export default TimeLineView;
