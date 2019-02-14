// @flow
import { Chart } from "react-google-charts";
import { Select, Card, Form, Row, Col, DatePicker } from "antd";
import * as React from "react";
import _ from "lodash";
import moment from "moment";

import type { APIUser, APITimeTracking } from "admin/api_flow_types";
import { formatMilliseconds } from "libs/format_utils";
import { getEditableUsers, getTimeTrackingForUser } from "admin/admin_rest_api";
import Toast from "libs/toast";
import messages from "messages";

const FormItem = Form.Item;
const Option = Select.Option;
const RangePicker = DatePicker.RangePicker;

type TimeTrackingStats = {
  totalTime: number,
  numberTasks: number,
  averageTimePerTask: number,
};

type DateRange = [moment$Moment, moment$Moment];

type State = {
  user: ?APIUser,
  users: Array<APIUser>,
  dateRange: DateRange,
  timeTrackingData: Array<APITimeTracking>,
  stats: TimeTrackingStats,
};

class TimeLineView extends React.PureComponent<*, State> {
  state = {
    user: null,
    users: [],
    dateRange: [moment().startOf("day"), moment().endOf("day")],
    timeTrackingData: [],
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
    const users = await getEditableUsers();
    this.setState({ users });
  }

  async fetchTimeTrackingData() {
    if (this.state.user != null) {
      /* eslint-disable react/no-access-state-in-setstate */
      const timeTrackingData = await getTimeTrackingForUser(
        this.state.user.id,
        this.state.dateRange[0],
        this.state.dateRange[1],
      );

      this.setState({ timeTrackingData }, this.calculateStats);
      /* eslint-enable react/no-access-state-in-setstate */
    }
  }

  calculateStats() {
    this.setState(prevState => {
      const totalTime = _.sumBy(prevState.timeTrackingData, timeSpan =>
        moment.duration(timeSpan.time).asMilliseconds(),
      );
      const numberTasks = _.uniq(prevState.timeTrackingData.map(timeSpan => timeSpan.annotation))
        .length;

      // prevent devision by zero
      const averageTimePerTask = numberTasks === 0 ? 0 : totalTime / numberTasks;

      return {
        stats: {
          totalTime,
          numberTasks,
          averageTimePerTask,
        },
      };
    });
  }

  handleUserChange = async (userId: number) => {
    await this.setState(prevState => ({ user: prevState.users.find(u => u.id === userId) }));
    this.fetchTimeTrackingData();
  };

  handleDateChange = async (dates: DateRange) => {
    // to ease the load on the server restrict date range selection to a month
    if (dates[0].diff(dates[1], "days") > 31) {
      Toast.error(messages["timetracking.date_range_too_long"]);
      return;
    }

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

    const { dateRange } = this.state;
    const timeTrackingRowGrouped = []; // shows each time span grouped by annotation id
    const timeTrackingRowTotal = []; // show all times spans in a single row

    this.state.timeTrackingData.forEach((datum: APITimeTracking) => {
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
      <div className="container">
        <h3>Time Tracking</h3>
        <Card>
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
                  {this.state.users
                    .filter(u => u.isActive)
                    .map((user: APIUser) => (
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
                  value={dateRange}
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
                    <li>{formatMilliseconds(this.state.stats.totalTime)}</li>
                    <li style={paddingBottom}>{this.state.stats.numberTasks}</li>
                    <li>{formatMilliseconds(this.state.stats.averageTimePerTask)}</li>
                  </ul>
                </Col>
              </Row>
              The time tracking information display here only includes data acquired when working on
              &quot;tasks&quot; and not explorative tracings.
            </Col>
          </Row>
        </Card>

        <div style={{ marginTop: 20 }}>
          {this.state.timeTrackingData.length > 0 ? (
            <Chart
              chartType="Timeline"
              columns={columns}
              rows={rows}
              options={{
                timeline: { singleColor: "#108ee9" },
                // Workaround for google-charts bug, see https://github.com/scalableminds/webknossos/pull/3772
                hAxis: {
                  minValue: dateRange[0].toDate(),
                  maxValue: dateRange[1].toDate(),
                },
              }}
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
