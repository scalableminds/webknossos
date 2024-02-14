import { Chart } from "react-google-charts";
import { Row, Col, Spin, Table, Card } from "antd";
import * as React from "react";
import _ from "lodash";
import dayjs from "dayjs";
import Request from "libs/request";
import * as Utils from "libs/utils";
import { APIProject, APITeam, APIUser } from "types/api_flow_types";
import { getProjects, getTeams } from "admin/admin_rest_api";

const { Column } = Table;

type TimeEntry = {
  start: string;
  end: string;
  tracingTime: number;
};
type State = {
  graphData: {
    timeGroupedByInterval: TimeEntry[];
  };
  timeEntries: Array<{
    tracingTimes: TimeEntry[];
    user: APIUser;
  }>;
  isGraphDataLoading: boolean;
  isTimeEntriesLoading: boolean;
  startDate: dayjs.Dayjs;
  endDate: dayjs.Dayjs;
  projects: APIProject[];
  teams: APITeam[];
};

type GoogleCharts = {
  chartWrapper: {
    getChart: () => {
      getSelection: Function;
    };
  }; // https://developers.google.com/chart/interactive/docs/drawing_charts#chartwrapper
};

class StatisticView extends React.PureComponent<{}, State> {
  state: State = {
    isGraphDataLoading: true,
    isTimeEntriesLoading: true,
    startDate: dayjs().startOf("week"),
    endDate: dayjs().endOf("week"),
    timeEntries: [],
    graphData: {
      timeGroupedByInterval: [],
    },
    teams: [],
    projects: [],
  };

  async componentDidMount() {
    await this.fetchTeams();
    await this.fetchProjects();
    this.fetchGraphData();
    this.fetchTimeEntryData();
  }

  toTimestamp(date: dayjs.Dayjs) {
    return date.unix() * 1000;
  }

  // TODO only last 12 months
  async fetchGraphData() {
    const graphDataURL = "/api/time/groupedByInterval?interval=week";
    const graphData = await Request.receiveJSON(graphDataURL);
    graphData.timeGroupedByInterval.sort(
      // @ts-expect-error ts-migrate(7031) FIXME: Binding element 'dateString1' implicitly has an 'a... Remove this comment to see the full error message
      ({ start: dateString1 }, { start: dateString2 }) =>
        // @ts-expect-error ts-migrate(2362) FIXME: The left-hand side of an arithmetic operation must... Remove this comment to see the full error message
        new Date(dateString2) - new Date(dateString1),
    );
    this.setState({
      isGraphDataLoading: false,
      graphData,
    });
  }

  // TODO make sure this works
  async fetchTimeEntryData() {
    const timeEntriesURL = `api/time/summed/userList?start=${this.toTimestamp(
      this.state.startDate,
    )}&end=${this.toTimestamp(this.state.endDate)}&onlyCountTasks=false&teamIds=${this.state.teams
      .map((team) => team.id)
      .join(",")}&projectIds=${this.state.projects.map((project) => project.id).join(",")}`;
    const timeEntries = await Request.receiveJSON(timeEntriesURL);
    this.setState({
      isTimeEntriesLoading: false,
      timeEntries,
    });
  }

  async fetchProjects() {
    const projects = await getProjects();
    this.setState({ projects });
  }

  async fetchTeams() {
    const teams = await getTeams();
    this.setState({ teams });
  }

  selectDataPoint = ({ chartWrapper }: GoogleCharts) => {
    const chart = chartWrapper.getChart();
    const indicies = chart.getSelection()[0];
    const startDate = this.state.graphData.timeGroupedByInterval[indicies.row].start;
    this.setState(
      {
        startDate: dayjs(startDate),
        endDate: dayjs(startDate).endOf("week"),
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
    const rows = this.state.graphData.timeGroupedByInterval.map((item) => {
      const duration = Utils.roundTo(dayjs.duration(item.tracingTime).asHours(), 2);
      return [
        new Date(item.start),
        duration,
        `${dayjs(item.start).format("DD.MM.YYYY")} - ${dayjs(item.end).format("DD.MM.YYYY")}
        ${duration}h`,
      ];
    });
    return (
      <div className="statistics container">
        <Row gutter={16}>
          <Col span={16}>
            <Card title="Overall Weekly Annotation Time">
              <Spin spinning={this.state.isGraphDataLoading} size="large">
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
        </Row>
      </div>
    );
  }
}

export default StatisticView;
