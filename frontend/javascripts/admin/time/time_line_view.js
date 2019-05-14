// @flow
import { Chart } from "react-google-charts";
import { Select, Card, Form, Row, Col, DatePicker } from "antd";
import * as React from "react";
import ReactDOMServer from "react-dom/server";
import { connect } from "react-redux";
import _ from "lodash";
import moment from "moment";

import { type OxalisState } from "oxalis/store";
import type { APIUser, APITimeTracking } from "admin/api_flow_types";
import { formatMilliseconds } from "libs/format_utils";
import { getEditableUsers, getTimeTrackingForUser } from "admin/admin_rest_api";
import Toast from "libs/toast";
import messages from "messages";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";

const FormItem = Form.Item;
const { Option } = Select;
const { RangePicker } = DatePicker;

type TimeTrackingStats = {
  totalTime: number,
  numberTasks: number,
  averageTimePerTask: number,
};

type DateRange = [moment$Moment, moment$Moment];

type StateProps = {|
  activeUser: APIUser,
|};

type Props = {| ...StateProps |};

type State = {
  user: ?APIUser,
  users: Array<APIUser>,
  dateRange: DateRange,
  timeTrackingData: Array<APITimeTracking>,
  stats: TimeTrackingStats,
};

class TimeLineView extends React.PureComponent<Props, State> {
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
    if (this.props.activeUser.isAdmin) {
      this.fetchData();
    } else {
      this.fetchDataFromLoggedInUser();
    }
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

      // prevent division by zero
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

  fetchDataFromLoggedInUser = async () => {
    await this.setState({ user: this.props.activeUser });
    this.fetchTimeTrackingData();
  };

  handleUserChange = async (userId: number) => {
    await this.setState(prevState => ({ user: prevState.users.find(u => u.id === userId) }));
    this.fetchTimeTrackingData();
  };

  handleDateChange = async (dates: DateRange) => {
    // to ease the load on the server restrict date range selection to a month
    if (Math.abs(dates[0].diff(dates[1], "days")) > 31) {
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

  getTooltipAsString() {
    const tooltip = (
      <div className="google-charts-tooltip">
        <div className="highlighted">
          Task ID: 1224523426324526
          <div className="striped-border" />
        </div>
        <table>
          <tbody>
            <tr>
              <td className="highlighted">Date:</td>
              <td>May, 5, 2019</td>
            </tr>
            <tr>
              <td className="highlighted">Time:</td>
              <td>17:15 - 20:00</td>
            </tr>
            <tr>
              <td className="highlighted">Duration:</td>
              <td>2:45 h</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
    return ReactDOMServer.renderToStaticMarkup(tooltip);
  }

  getMockUpChart() {
    const dateTicks = [];
    const startingDate = moment().subtract(4, "days");
    const endDate = moment();
    // console.log(startingDate, endDate);
    for (
      let currentDate = startingDate.clone();
      moment().diff(currentDate) >= 0;
      currentDate.add(1, "days")
    ) {
      // console.log(currentDate.toDate());
      dateTicks.push(currentDate.clone());
    }
    return (
      <Chart
        width="100%"
        height="200px"
        chartType="Timeline"
        loader={<div>Loading Time Tracking Chart</div>}
        data={[
          [
            { type: "string", id: "AnnotationId" },
            { type: "string", id: "empty bar label" },
            {
              type: "string",
              role: "tooltip",
              p: { html: true },
            },
            { type: "date", id: "Start" },
            { type: "date", id: "End" },
          ],
          [
            "3243215132452345",
            null,
            this.getTooltipAsString(),
            moment()
              .subtract(3, "days")
              .subtract(18, "hours"),
            moment()
              .subtract(3, "days")
              .subtract(12, "hours"),
          ],
          [
            "3243215132452345",
            null,
            this.getTooltipAsString(),
            moment().subtract(3, "days"),
            moment()
              .subtract(2, "days")
              .subtract(12, "hours"),
          ],
          [
            "23452345234532452",
            null,
            this.getTooltipAsString(),
            moment().subtract(2, "days"),
            moment()
              .subtract(1, "days")
              .subtract(18, "hours"),
          ],
          [
            "234532532453252",
            null,
            this.getTooltipAsString(),
            moment().subtract(2, "days"),
            moment()
              .subtract(1, "days")
              .subtract(18, "hours"),
          ],
        ]}
        options={{
          allowHtml: true,
          tooltip: { isHtml: true },
          timeline: { groupByRowLabel: true },
          hAxis: {
            format: "MMM, dd, YYYY",
            // minValue: startingDate,
            // maxValue: endDate,
            ticks: [
              new Date(2019, 5, 11),
              new Date(2019, 5, 12),
              new Date(2019, 5, 13),
              new Date(2019, 5, 14),
            ],
            // gridlines: { color: "#333", count: 4 },
          },
        }}
      />
    );
  }

  render() {
    const columns = [
      { id: "AnnotationId", type: "string" },
      { id: "Start", type: "date" },
      { id: "End", type: "date" },
      { type: "string", role: "tooltip" },
      // { id: "Duration - end", type: "date", role: "tooltip"}
    ];

    const { dateRange } = this.state;
    const timeTrackingRowGrouped = []; // shows each time span grouped by annotation id
    const timeTrackingRowTotal = []; // show all times spans in a single row

    this.state.timeTrackingData.forEach((datum: APITimeTracking) => {
      const duration = moment.duration(datum.time).asMilliseconds();
      const start = new Date(datum.timestamp);
      const end = new Date(datum.timestamp + duration);

      // const durationAsString = `${moment(start).format("MMM, dd, YYYY")} - ${moment(end).format("MMM, dd, YYYY")}`;
      const durationAsString = "awesome stuff";
      timeTrackingRowGrouped.push([datum.task_id, start, end, durationAsString]);
      // timeTrackingRowTotal.push(["Sum Tracking Time", start, end]);
      timeTrackingRowTotal.push(["Sum Tracking Time", start, end, durationAsString]);
    });

    const rows = timeTrackingRowTotal.concat(timeTrackingRowGrouped);

    const formItemLayout = {
      labelCol: { span: 5 },
      wrapperCol: { span: 19 },
    };

    const paddingBottom = {
      paddingBottom: 5,
    };

    // console.log("diff", dateRange[0].diff(dateRange[1], "days"))
    const displayInDays = Math.abs(dateRange[0].diff(dateRange[1], "days")) >= 1;
    const timeAxisFormat = displayInDays ? "MMM, dd, YYYY" : "HH:mm";

    /* const dateTicks = [];
    if(displayInDays){
      for (let currentDay = dateRange[0].clone(); dateRange[1].diff(currentDay, "day") > 0; currentDay.add(1, "day")) {
        dateTicks.push(currentDay.clone());
      }
      dateTicks.push(dateRange[1].clone());
      console.log("ticks", dateTicks);
    } */

    const { isAdmin, firstName, lastName, email } = this.props.activeUser;
    return (
      <div className="container">
        <h3>Time Tracking</h3>
        <Card>
          <Row gutter={40}>
            <Col span={12}>
              <FormItem {...formItemLayout} label="User">
                {isAdmin ? (
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
                          {`${user.lastName}, ${user.firstName} (${user.email})`}
                        </Option>
                      ))}
                  </Select>
                ) : (
                  <table style={{ width: "100%", fontSize: 16 }}>
                    <tbody>
                      <tr>
                        <td style={{ width: "50%" }}>
                          {lastName}, {firstName}
                        </td>
                        <td style={{ width: "50%" }}> {email}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
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
          {this.getMockUpChart()}
          {this.state.timeTrackingData.length > 0 ? (
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
                tooltip: { isHtml: true },
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

const mapStateToProps = (state: OxalisState) => ({
  activeUser: enforceActiveUser(state.activeUser),
});

export default connect<Props, {||}, _, _, _, _>(mapStateToProps)(TimeLineView);
