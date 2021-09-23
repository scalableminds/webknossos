// @flow
import { Select, Card, Form, Row, Col, DatePicker, Spin } from "antd";
import * as React from "react";
import ReactDOMServer from "react-dom/server";
import { connect } from "react-redux";
import _ from "lodash";
import moment from "moment";
import FormattedDate from "components/formatted_date";
import { type OxalisState } from "oxalis/store";
import type { APIUser, APITimeTracking } from "types/api_flow_types";
import { formatMilliseconds, formatDurationToMinutesAndSeconds } from "libs/format_utils";
import { isUserAdminOrTeamManager } from "libs/utils";
import { getEditableUsers, getTimeTrackingForUser } from "admin/admin_rest_api";
import Toast from "libs/toast";
import messages from "messages";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import TimeTrackingChart, {
  type DateRange,
  type ColumnDefinition,
  type RowContent,
} from "./time_line_chart_view";

const FormItem = Form.Item;
const { RangePicker } = DatePicker;

const dayFormat = "dd, MMM, YYYY";
const hourFormat = "HH:mm";
const hourFormatPrecise = "HH:mm:ss";

type TimeTrackingStats = {
  totalTime: number,
  numberTasks: number,
  averageTimePerTask: number,
};

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
  isLoading: boolean,
  isFetchingUsers: boolean,
};

function compressTimeLogs(logs) {
  logs.sort((a, b) => a.timestamp - b.timestamp);

  const compressedLogs = [];
  let previousLog = null;
  for (const timeLog of logs) {
    // If the current log is within 1s of the previous log, merge these two logs
    const previousDuration = previousLog != null ? moment.duration(previousLog.time) : null;
    if (
      previousDuration != null &&
      previousLog != null &&
      Math.abs(timeLog.timestamp - (previousLog.timestamp + previousDuration.asMilliseconds())) <
        1000 &&
      timeLog.task_id === previousLog.task_id
    ) {
      const newDuration = previousDuration.add(moment.duration(timeLog.time));
      const copiedLog = { ...compressedLogs[compressedLogs.length - 1] };
      copiedLog.time = newDuration.toISOString();
      compressedLogs[compressedLogs.length - 1] = copiedLog;
    } else {
      compressedLogs.push(timeLog);
    }

    previousLog = compressedLogs[compressedLogs.length - 1];
  }

  return compressedLogs;
}

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
    isLoading: false,
    isFetchingUsers: false,
  };

  componentDidMount() {
    const isAdminOrTeamManger = isUserAdminOrTeamManager(this.props.activeUser);
    if (isAdminOrTeamManger) {
      this.fetchData();
    } else {
      this.fetchDataFromLoggedInUser();
    }
  }

  async fetchData() {
    this.setState({ isFetchingUsers: true });
    const users = await getEditableUsers();
    this.setState({ users, isFetchingUsers: false });
  }

  async fetchTimeTrackingData() {
    this.setState({ isLoading: true });
    if (this.state.user != null) {
      /* eslint-disable react/no-access-state-in-setstate */
      const timeTrackingData = compressTimeLogs(
        await getTimeTrackingForUser(
          this.state.user.id,
          this.state.dateRange[0],
          this.state.dateRange[1],
        ),
      );

      this.setState({ timeTrackingData }, this.calculateStats);
      /* eslint-enable react/no-access-state-in-setstate */
    }
    this.setState({ isLoading: false });
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

    // Force an interval of at least one minute.
    const dateRange = dates[0].isSame(dates[1], "minute")
      ? [dates[0].startOf("day"), dates[0].add(1, "minute")]
      : dates;

    await this.setState({ dateRange });
    this.fetchTimeTrackingData();
  };

  getTooltipForEntry(taskId: string, start: Date, end: Date) {
    const isSameDay = start.getUTCDate() === end.getUTCDate();
    const duration = end - start;
    const durationAsString = formatDurationToMinutesAndSeconds(duration);
    const dayFormatForMomentJs = "DD MMM, YYYY";
    const tooltip = (
      <div>
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
                    <FormattedDate timestamp={start} format={dayFormatForMomentJs} /> –{" "}
                    <FormattedDate timestamp={end} format={dayFormatForMomentJs} />
                  </React.Fragment>
                )}
              </td>
            </tr>
            <tr>
              <td className="highlighted">Time:</td>
              <td>
                <FormattedDate timestamp={start} format={hourFormatPrecise} /> –{" "}
                <FormattedDate timestamp={end} format={hourFormatPrecise} />
              </td>
            </tr>
            <tr>
              <td className="highlighted">Duration (min:sec):</td>
              <td>{durationAsString}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
    return ReactDOMServer.renderToStaticMarkup(tooltip);
  }

  render() {
    const columns: Array<ColumnDefinition> = [
      { id: "AnnotationId", type: "string" },
      // This label columns is somehow needed to make the custom tooltip work.
      // See https://developers.google.com/chart/interactive/docs/gallery/timeline#customizing-tooltips.
      { type: "string", id: "empty label" },
      { type: "string", role: "tooltip", p: { html: true } },
      { id: "Start", type: "date" },
      { id: "End", type: "date" },
    ];

    const { dateRange, isLoading, timeTrackingData } = this.state;
    const timeTrackingRowGrouped: Array<RowContent> = []; // shows each time span grouped by annotation id
    const timeTrackingRowTotal: Array<RowContent> = []; // show all times spans in a single row

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

    const { firstName, lastName, email } = this.props.activeUser;
    const isAdminOrTeamManger = isUserAdminOrTeamManager(this.props.activeUser);

    return (
      <div className="container">
        <h3>Time Tracking</h3>
        <Card>
          <Row gutter={40}>
            <Col span={12}>
              <FormItem {...formItemLayout} label="User">
                {isAdminOrTeamManger ? (
                  <Select
                    allowClear
                    showSearch
                    placeholder="Select a User"
                    optionFilterProp="label"
                    style={{ width: "100%" }}
                    onChange={this.handleUserChange}
                    notFoundContent={this.state.isFetchingUsers ? <Spin size="small" /> : "No Data"}
                    options={this.state.users
                      .filter(u => u.isActive)
                      .map((user: APIUser) => ({
                        value: user.id,
                        label: `${user.lastName}, ${user.firstName} (${user.email})`,
                      }))}
                  />
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
                  showTime={{ format: "HH:mm" }}
                  format="YYYY-MM-DD HH:mm"
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
              The time tracking information displayed here only includes data acquired when working
              on &quot;tasks&quot; and not explorative annotations.
            </Col>
          </Row>
        </Card>

        <div style={{ marginTop: 20 }} />
        <Spin size="large" spinning={isLoading}>
          {timeTrackingData.length > 0 ? (
            <div style={{ backgroundColor: "white" }}>
              <TimeTrackingChart
                columns={columns}
                rows={rows}
                timeAxisFormat={timeAxisFormat}
                dateRange={dateRange}
                timeTrackingData={timeTrackingData}
              />
            </div>
          ) : (
            <div style={{ textAlign: "center" }}>
              No Time Tracking Data for the Selected User or Date Range.
            </div>
          )}
        </Spin>
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  activeUser: enforceActiveUser(state.activeUser),
});

export default connect<Props, {||}, _, _, _, _>(mapStateToProps)(TimeLineView);
