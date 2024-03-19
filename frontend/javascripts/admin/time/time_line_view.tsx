import { Select, Card, Form, Row, Col, Spin, DatePicker } from "antd";
import * as React from "react";
import ReactDOMServer from "react-dom/server";
import { connect } from "react-redux";
import _ from "lodash";
import dayjs from "dayjs";
import FormattedDate from "components/formatted_date";
import { formatMilliseconds, formatDurationToMinutesAndSeconds } from "libs/format_utils";
import { isUserAdminOrTeamManager } from "libs/utils";
import {
  getEditableUsers,
  getProjects,
  getTimeTrackingForUser,
  getUser,
} from "admin/admin_rest_api";
import Toast from "libs/toast";
import messages from "messages";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import TimeTrackingChart from "./time_line_chart_view";

import type { APIUser, APITimeTracking, APIProject } from "types/api_flow_types";
import type { OxalisState } from "oxalis/store";
import type { DateRange, ColumnDefinition, RowContent } from "./time_line_chart_view";
import * as Utils from "libs/utils";
import ProjectAndAnnotationTypeDropdown, {
  AnnotationTypeFilterEnum,
} from "admin/statistic/project_and_annotation_type_dropdown";

const FormItem = Form.Item;
const { RangePicker } = DatePicker;

const dayFormat = "dd, MMM, YYYY";
const hourFormat = "HH:mm";
const hourFormatPrecise = "HH:mm:ss";

type TimeTrackingStats = {
  totalTime: number;
  numberTasks: number;
  averageTimePerTask: number;
};
type StateProps = {
  activeUser: APIUser;
};
type Props = StateProps;
type State = {
  user: APIUser | null | undefined;
  users: Array<APIUser>;
  dateRange: DateRange;
  timeTrackingData: Array<APITimeTracking>;
  stats: TimeTrackingStats;
  isLoading: boolean;
  isFetchingUsers: boolean;
  initialUserId: string | null;
  selectedProjectIds: string[];
  allProjects: APIProject[];
  annotationType: AnnotationTypeFilterEnum;
};

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'logs' implicitly has an 'any' type.
function compressTimeLogs(logs) {
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'a' implicitly has an 'any' type.
  logs.sort((a, b) => a.timestamp - b.timestamp);
  const compressedLogs = [];
  let previousLog = null;

  for (const timeLog of logs) {
    // If the current log is within 1s of the previous log, merge these two logs
    const previousDuration = previousLog != null ? dayjs.duration(previousLog.time) : null;

    if (
      previousDuration != null &&
      previousLog != null &&
      Math.abs(timeLog.timestamp - (previousLog.timestamp + previousDuration.asMilliseconds())) <
        1000 &&
      timeLog.task_id === previousLog.task_id
    ) {
      const newDuration = previousDuration.add(dayjs.duration(timeLog.time));
      // @ts-expect-error ts-migrate(7022) FIXME: 'copiedLog' implicitly has type 'any' because it d... Remove this comment to see the full error message
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
  state: State = {
    user: null,
    users: [],
    dateRange: [dayjs().startOf("day"), dayjs().endOf("day")],
    timeTrackingData: [],
    stats: {
      totalTime: 0,
      numberTasks: 0,
      averageTimePerTask: 0,
    },
    isLoading: false,
    isFetchingUsers: false,
    initialUserId: null,
    selectedProjectIds: [],
    allProjects: [],
    annotationType: AnnotationTypeFilterEnum.TASKS_AND_ANNOTATIONS_KEY,
  };

  parseQueryParams() {
    const params = Utils.getUrlParamsObject();
    let dateRange: DateRange = [dayjs().startOf("day"), dayjs().endOf("day")];
    if (params == null) return { initialUserId: null };
    const hasStart = _.has(params, "start");
    const hasEnd = _.has(params, "end");
    // if either start or end is provided, use one week as default range
    if (!hasStart && hasEnd) {
      const end = dayjs(+params.end); // + leads to the timestamp being parsed as number; omitting it leads to wrong parsing
      dateRange = [end.subtract(7, "d"), end];
    } else if (hasStart && !hasEnd) {
      const start = dayjs(+params.start);
      dateRange = [start, start.add(7, "d")];
    } else if (hasStart && hasEnd) {
      dateRange = [dayjs(+params.start), dayjs(+params.end)];
    }
    let selectedProjectIds: Array<string> = [];
    let annotationType = AnnotationTypeFilterEnum.TASKS_AND_ANNOTATIONS_KEY;
    if (_.has(params, "projectsOrType")) {
      const projectsOrTypeParam = params.projectsOrType;
      if (Object.values<string>(AnnotationTypeFilterEnum).includes(projectsOrTypeParam)) {
        annotationType = projectsOrTypeParam as AnnotationTypeFilterEnum;
      } else {
        selectedProjectIds = params.projectsOrType.split(",");
      }
    }
    this.setState({
      initialUserId: _.has(params, "user") ? params.user : null,
      annotationType,
      selectedProjectIds,
    });
    this.handleDateChange(dateRange);
  }

  async componentDidMount() {
    const isAdminOrTeamManger = isUserAdminOrTeamManager(this.props.activeUser);
    this.parseQueryParams();
    if (isAdminOrTeamManger) {
      await this.fetchData();
    } else {
      this.fetchDataFromLoggedInUser();
    }
  }

  async componentDidUpdate(_prevProps: Props, prevState: State) {
    if (
      prevState.annotationType !== this.state.annotationType ||
      prevState.selectedProjectIds !== this.state.selectedProjectIds ||
      prevState.dateRange !== this.state.dateRange ||
      prevState.user !== this.state.user
    ) {
      await this.fetchTimeTrackingData();
    }
  }

  async fetchData() {
    this.setState({
      isFetchingUsers: true,
    });
    const currentUser =
      this.state.initialUserId != null && isUserAdminOrTeamManager(this.props.activeUser)
        ? await getUser(this.state.initialUserId)
        : this.props.activeUser;
    const [users, allProjects] = await Promise.all([getEditableUsers(), getProjects()]);
    this.setState({
      user: currentUser,
      users,
      allProjects: allProjects,
      isFetchingUsers: false,
    });
  }

  fetchTimeTrackingData = async () => {
    this.setState({
      isLoading: true,
    });

    if (this.state.user != null) {
      const timeTrackingData = compressTimeLogs(
        await getTimeTrackingForUser(
          this.state.user.id,
          this.state.dateRange[0],
          this.state.dateRange[1],
          this.state.annotationType,
          this.state.selectedProjectIds,
        ),
      );
      this.setState(
        {
          timeTrackingData,
        },
        this.calculateStats,
      );
    }

    this.setState({
      isLoading: false,
    });
  };

  calculateStats() {
    this.setState((prevState) => {
      const totalTime = _.sumBy(prevState.timeTrackingData, (timeSpan) =>
        dayjs.duration(timeSpan.time).asMilliseconds(),
      );

      const numberTasks = _.uniq(
        prevState.timeTrackingData.map((timeSpan) => timeSpan.annotation),
      ).length;

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

  fetchDataFromLoggedInUser = () => {
    this.setState({
      user: this.props.activeUser,
    });
  };

  handleUserChange = (userId: string) => {
    this.setState((prevState) => ({
      user: prevState.users.find((u) => u.id === userId),
    }));
  };

  handleDateChange = async (dates: DateRange) => {
    // to ease the load on the server restrict date range selection to three month
    if (Math.abs(dates[0].diff(dates[1], "days")) > 3 * 31) {
      Toast.error(messages["timetracking.date_range_too_long"]);
      return;
    }

    // Force an interval of at least one minute.
    const dateRange: DateRange = dates[0].isSame(dates[1], "minute")
      ? [dates[0].startOf("day"), dates[0].add(1, "minute")]
      : dates;
    this.setState({
      dateRange,
    });
  };

  getTooltipForEntry(annotationOrTaskLabel: string, start: Date, end: Date) {
    const isSameDay = start.getUTCDate() === end.getUTCDate();
    const duration = end.getTime() - start.getTime();
    const durationAsString = formatDurationToMinutesAndSeconds(duration);
    const dayFormatForDayJs = "DD MMM, YYYY";
    const tooltip = (
      <div>
        <div className="highlighted">
          {annotationOrTaskLabel}
          <div className="striped-border" />
        </div>

        <table>
          <tbody>
            <tr>
              <td className="highlighted">Date:</td>
              <td>
                {isSameDay ? (
                  <FormattedDate timestamp={start} format={dayFormatForDayJs} />
                ) : (
                  <React.Fragment>
                    <FormattedDate timestamp={start} format={dayFormatForDayJs} /> –{" "}
                    <FormattedDate timestamp={end} format={dayFormatForDayJs} />
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
      {
        id: "AnnotationId",
        type: "string",
      }, // This label columns is somehow needed to make the custom tooltip work.
      // See https://developers.google.com/chart/interactive/docs/gallery/timeline#customizing-tooltips.
      {
        type: "string",
        id: "empty label",
      },
      {
        type: "string",
        role: "tooltip",
        p: {
          html: true,
        },
      },
      {
        id: "Start",
        type: "date",
      },
      {
        id: "End",
        type: "date",
      },
    ];
    const { dateRange, isLoading, timeTrackingData } = this.state;
    const timeTrackingRowGrouped: Array<RowContent> = []; // shows each time span grouped by annotation id

    const timeTrackingRowTotal: Array<RowContent> = []; // show all times spans in a single row

    const totalSumColumnLabel = "Sum Tracking Time";
    for (const datum of this.state.timeTrackingData) {
      const duration = dayjs.duration(datum.time).asMilliseconds();
      const start = new Date(datum.timestamp);
      const end = new Date(datum.timestamp + duration);
      const tooltipTitle =
        datum.task_id != null ? `Task: ${datum.task_id}` : `Annotation: ${datum.annotation}`;
      const individualTooltipAsString = this.getTooltipForEntry(tooltipTitle, start, end);
      const totalTooltipAsString = this.getTooltipForEntry(totalSumColumnLabel, start, end);
      timeTrackingRowGrouped.push([tooltipTitle, "", individualTooltipAsString, start, end]);
      timeTrackingRowTotal.push([totalSumColumnLabel, "", totalTooltipAsString, start, end]);
    }
    const rows = timeTrackingRowTotal.concat(timeTrackingRowGrouped);
    const formItemLayout = {
      labelCol: {
        span: 5,
      },
      wrapperCol: {
        span: 19,
      },
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
                    style={{
                      width: "100%",
                    }}
                    onChange={this.handleUserChange}
                    loading={this.state.isFetchingUsers}
                    options={this.state.users
                      .filter((u) => u.isActive)
                      .map((user: APIUser) => ({
                        value: user.id,
                        label: `${user.lastName}, ${user.firstName} (${user.email})`,
                      }))}
                    value={this.state.user?.id}
                  />
                ) : (
                  <table
                    style={{
                      width: "100%",
                      fontSize: 16,
                    }}
                  >
                    <tbody>
                      <tr>
                        <td
                          style={{
                            width: "50%",
                          }}
                        >
                          {lastName}, {firstName}
                        </td>
                        <td
                          style={{
                            width: "50%",
                          }}
                        >
                          {" "}
                          {email}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </FormItem>
              <FormItem {...formItemLayout} label="Date">
                <RangePicker
                  showTime={{
                    format: "HH:mm",
                  }}
                  format="YYYY-MM-DD HH:mm"
                  allowClear={false}
                  style={{
                    width: "100%",
                  }}
                  value={dateRange}
                  // @ts-expect-error ts-migrate(2322) FIXME: Type '(dates: DateRange) => Promise<void>' is not ... Remove this comment to see the full error message
                  // TODO maybe also apply fix here
                  onChange={this.handleDateChange}
                />
              </FormItem>
              <FormItem {...formItemLayout} label="Type / Project">
                <ProjectAndAnnotationTypeDropdown
                  selectedProjectIds={this.state.selectedProjectIds}
                  setSelectedProjectIds={(selectedProjectIds: string[]) =>
                    this.setState({ selectedProjectIds })
                  }
                  setSelectedAnnotationType={(annotationType: AnnotationTypeFilterEnum) =>
                    this.setState({ annotationType })
                  }
                  selectedAnnotationType={this.state.annotationType}
                />
              </FormItem>
            </Col>
            <Col span={12}>
              <Row>
                <Col span={8}>
                  <ul>
                    <li style={paddingBottom}>Total Time:</li>
                    <li style={paddingBottom}>Number of Tasks / Annotations:</li>
                    <li>Average Time per Task / Annotation:</li>
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
            </Col>
          </Row>
        </Card>

        <div
          style={{
            marginTop: 20,
          }}
        />
        <Spin size="large" spinning={isLoading}>
          {timeTrackingData.length > 0 ? (
            <div
              style={{
                backgroundColor: "white",
              }}
            >
              <TimeTrackingChart
                columns={columns}
                rows={rows}
                timeAxisFormat={timeAxisFormat}
                dateRange={dateRange}
              />
            </div>
          ) : (
            <div
              style={{
                textAlign: "center",
              }}
            >
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

const connector = connect(mapStateToProps);
export default connector(TimeLineView);
