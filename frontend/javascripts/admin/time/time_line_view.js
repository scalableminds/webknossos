// @flow
import { Chart } from "react-google-charts";
import { Select, Card, Form, Row, Col, DatePicker } from "antd";
import * as React from "react";
import ReactDOMServer from "react-dom/server";
import { connect } from "react-redux";
import _ from "lodash";
import moment from "moment";
import FormattedDate from "components/formatted_date";
import { type OxalisState } from "oxalis/store";
import type { APIUser, APITimeTracking } from "admin/api_flow_types";
import { formatMilliseconds, formatDurationToHoursAndMinutes } from "libs/format_utils";
import { getEditableUsers, getTimeTrackingForUser } from "admin/admin_rest_api";
import Toast from "libs/toast";
import messages from "messages";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";

const FormItem = Form.Item;
const { Option } = Select;
const { RangePicker } = DatePicker;

const dayFormat = "MMM, dd, YYYY";
const hourFormat = "HH:mm";

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

  getTooltipForEntry(taskId, start, end) {
    const isSameDay = start.getUTCDate() === end.getUTCDate();
    const duration = end - start;
    const durationAsString = formatDurationToHoursAndMinutes(duration);
    const dayFormatForMomentJs = "MMM, DD, YYYY";
    const tooltip = (
      <div className="google-charts-tooltip">
        <div className="highlighted">
          Task ID: {taskId}
          <div className="striped-border" />
        </div>

        <table>
          <tbody>
            <tr>
              <td className="highlighted">Date:</td>
              <td>
                {isSameDay ? (
                  <FormattedDate timestamp={start} format={dayFormatForMomentJs} />
                ) : (
                  <React.Fragment>
                    <FormattedDate timestamp={start} format={dayFormatForMomentJs} /> -{" "}
                    <FormattedDate timestamp={end} format={dayFormatForMomentJs} />
                  </React.Fragment>
                )}
              </td>
            </tr>
            <tr>
              <td className="highlighted">Time:</td>
              <td>
                <FormattedDate timestamp={start} format={hourFormat} /> -{" "}
                <FormattedDate timestamp={end} format={hourFormat} />
              </td>
            </tr>
            <tr>
              <td className="highlighted">Duration:</td>
              <td>{durationAsString}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
    return ReactDOMServer.renderToStaticMarkup(tooltip);
  }

  render() {
    const columns = [
      { id: "AnnotationId", type: "string" },
      { type: "string", id: "empty label" },
      { type: "string", role: "tooltip", p: { html: true } },
      { id: "Start", type: "date" },
      { id: "End", type: "date" },
    ];

    const { dateRange } = this.state;
    const timeTrackingRowGrouped = []; // shows each time span grouped by annotation id
    const timeTrackingRowTotal = []; // show all times spans in a single row

    const totalSumColumnLabel = "Sum Tracking Time";

    this.state.timeTrackingData.forEach((datum: APITimeTracking) => {
      const duration = moment.duration(datum.time).asMilliseconds();
      const start = new Date(datum.timestamp);
      const end = new Date(datum.timestamp + duration);
      const individualTooltipAsString = this.getTooltipForEntry(datum.task_id, start, end);
      const totalTooltipAsString = this.getTooltipForEntry(totalSumColumnLabel, start, end);

      timeTrackingRowGrouped.push([datum.task_id, "", individualTooltipAsString, start, end]);
      timeTrackingRowTotal.push([totalSumColumnLabel, "", totalTooltipAsString, start, end]);
    });

    const rows = timeTrackingRowTotal.concat(timeTrackingRowGrouped);

    const formItemLayout = {
      labelCol: { span: 5 },
      wrapperCol: { span: 19 },
    };

    const paddingBottom = {
      paddingBottom: 5,
    };

    const displayInDays = Math.abs(dateRange[0].diff(dateRange[1], "days")) >= 1;
    const timeAxisFormat = displayInDays ? dayFormat : hourFormat;

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
                allowHtml: true,
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
