import { DownloadOutlined, FilterOutlined } from "@ant-design/icons";
import { getTeams, getTimeEntries, getTimeTrackingForUserSpans } from "admin/admin_rest_api";
import { Button, Card, DatePicker, Select, Spin, Table, type TimeRangePickerProps } from "antd";
import FixedExpandableTable from "components/fixed_expandable_table";
import LinkButton from "components/link_button";
import dayjs, { type Dayjs } from "dayjs";
import saveAs from "file-saver";
import { formatMilliseconds } from "libs/format_utils";
import { useFetch } from "libs/react_helpers";
import Toast from "libs/toast";
import { isUserAdminOrTeamManager, transformToCSVRow } from "libs/utils";
import * as Utils from "libs/utils";
import messages from "messages";
import { AnnotationStateFilterEnum, AnnotationTypeFilterEnum } from "oxalis/constants";
import type { WebknossosState } from "oxalis/store";
import { useState } from "react";
import { useSelector } from "react-redux";
import type { APITimeTrackingPerUser } from "types/api_types";
import ProjectAndAnnotationTypeDropdown from "./project_and_annotation_type_dropdown";
import TimeTrackingDetailView from "./time_tracking_detail_view";
const { RangePicker } = DatePicker;

const TIMETRACKING_CSV_HEADER_PER_USER = ["userId,userFirstName,userLastName,timeTrackedInSeconds"];
const TIMETRACKING_CSV_HEADER_SPANS = [
  "userId,email,datasetOrga,datasetName,annotation,annotationState,startTimeUnixTimestamp,durationInSeconds,taskId,projectName,taskTypeId,taskTypeSummary",
];

function TimeTrackingOverview() {
  const currentTime = dayjs();
  const [startDate, setStartDate] = useState(currentTime.startOf("month"));
  const [endDate, setEndeDate] = useState(currentTime);
  const [isFetching, setIsFetching] = useState(false);
  const isCurrentUserAdminOrManager = useSelector((state: WebknossosState) => {
    const activeUser = state.activeUser;
    return activeUser != null && isUserAdminOrTeamManager(activeUser);
  });
  const allTeams = useFetch(
    async () => {
      setIsFetching(true);
      const allTeams = await getTeams();
      setIsFetching(false);
      return allTeams;
    },
    [],
    [],
  );

  const [selectedProjectIds, setSelectedProjectIds] = useState(Array<string>);
  const [selectedTypes, setSelectedTypes] = useState(
    AnnotationTypeFilterEnum.TASKS_AND_ANNOTATIONS_KEY,
  );
  const [selectedState, setSelectedState] = useState(AnnotationStateFilterEnum.ALL);
  const [selectedTeams, setSelectedTeams] = useState(allTeams.map((team) => team.id));
  const filteredTimeEntries = useFetch(
    async () => {
      setIsFetching(true);
      const filteredEntries = await getTimeEntries(
        startDate.valueOf(),
        endDate.valueOf(),
        selectedTeams,
        selectedTypes,
        selectedState,
        selectedProjectIds,
      );
      setIsFetching(false);
      return filteredEntries;
    },
    [],
    [selectedTeams, selectedTypes, selectedState, selectedProjectIds, startDate, endDate],
  );
  const filterStyle = { marginInline: 10 };

  const downloadTimeSpans = async (
    userId: string,
    start: Dayjs,
    end: Dayjs,
    annotationTypes: AnnotationTypeFilterEnum,
    selectedState: AnnotationStateFilterEnum,
    projectIds: string[] | null | undefined,
  ) => {
    const timeSpans = await getTimeTrackingForUserSpans(
      userId,
      start.valueOf(),
      end.valueOf(),
      annotationTypes,
      selectedState,
      projectIds,
    );
    const timeEntriesAsString = timeSpans
      .map((row) => {
        return transformToCSVRow([
          row.userId,
          row.userEmail,
          row.datasetOrganization,
          row.datasetName,
          row.annotationId,
          row.annotationState,
          row.timeSpanCreated,
          Math.ceil(row.timeSpanTimeMillis / 1000),
          row.taskId,
          row.projectName,
          row.taskTypeId,
          row.taskTypeSummary,
        ]);
      })
      .join("\n"); // rows starting on new lines
    const csv = [TIMETRACKING_CSV_HEADER_SPANS, timeEntriesAsString].join("\n");
    const filename = `timetracking-user-export-${userId}.csv`;
    const blob = new Blob([csv], {
      type: "text/plain;charset=utf-8",
    });
    saveAs(blob, filename);
  };

  const exportToCSV = () => {
    if (filteredTimeEntries?.length === null) {
      return;
    }
    const timeEntriesAsString = filteredTimeEntries
      .map((row) => {
        return transformToCSVRow([
          row.user.id,
          row.user.firstName,
          row.user.lastName,
          Math.round(row.timeMillis / 1000),
        ]);
      })
      .join("\n");
    const csv = [TIMETRACKING_CSV_HEADER_PER_USER, timeEntriesAsString].join("\n");
    const filename = "timetracking-export.csv";
    const blob = new Blob([csv], {
      type: "text/plain;charset=utf-8",
    });
    saveAs(blob, filename);
  };

  const rangePresets: TimeRangePickerProps["presets"] = [
    { label: "Last 7 Days", value: [dayjs().subtract(7, "d").startOf("day"), currentTime] },
    { label: "Last 30 Days", value: [dayjs().subtract(30, "d").startOf("day"), currentTime] },
  ];

  const renderPlaceholder = () => {
    return (
      <p>
        There is no user activity recorded for the selected time span. Please adjust the time range
        and filters above.
      </p>
    );
  };

  const timeTrackingTableColumns = [
    {
      title: "User",
      dataIndex: "user",
      key: "user",
      render: (user: APITimeTrackingPerUser["user"]) =>
        `${user.lastName}, ${user.firstName} (${user.email})`,
      sorter: Utils.localeCompareBy<APITimeTrackingPerUser>(
        (timeEntry) =>
          `${timeEntry.user.lastName}, ${timeEntry.user.firstName} (${timeEntry.user.email})`,
      ),
    },
    {
      title: "No. tasks / annotations",
      dataIndex: "annotationCount",
      key: "numberAnn",
      sorter: Utils.compareBy<APITimeTrackingPerUser>((timeEntry) => timeEntry.annotationCount),
    },
    {
      title: "Avg. time per task / annotation",
      key: "avgTime",
      render: (item: APITimeTrackingPerUser) =>
        formatMilliseconds(item.timeMillis / item.annotationCount),
      sorter: Utils.compareBy<APITimeTrackingPerUser>(
        (timeEntry) => timeEntry.timeMillis / timeEntry.annotationCount,
      ),
    },
    {
      title: "Total time",
      dataIndex: "timeMillis",
      key: "tracingTimes",
      render: (tracingTimeInMs: APITimeTrackingPerUser["timeMillis"]) =>
        formatMilliseconds(tracingTimeInMs),
      sorter: Utils.compareBy<APITimeTrackingPerUser>((timeEntry) => timeEntry.timeMillis),
    },
    {
      key: "details",
      dataIndex: "user",
      render: (user: APITimeTrackingPerUser["user"]) => {
        return (
          <LinkButton
            onClick={async () => {
              downloadTimeSpans(
                user.id,
                startDate,
                endDate,
                selectedTypes,
                selectedState,
                selectedProjectIds,
              );
            }}
            icon={<DownloadOutlined />}
          >
            Download time spans
          </LinkButton>
        );
      },
    },
  ];

  const getSummaryRow = (pageData: readonly APITimeTrackingPerUser[]) => {
    if (pageData.length === 0) {
      return null;
    }
    let totalNumberOfTasksAndAnnotations = 0;
    let totalTimeMs = 0;
    pageData.forEach(({ timeMillis, annotationCount }) => {
      totalNumberOfTasksAndAnnotations += annotationCount;
      totalTimeMs += timeMillis;
    });
    return (
      <>
        <Table.Summary.Row>
          <Table.Summary.Cell index={0} />
          <Table.Summary.Cell index={1}>
            <b>Total</b>
          </Table.Summary.Cell>
          <Table.Summary.Cell index={2}> {totalNumberOfTasksAndAnnotations} </Table.Summary.Cell>
          <Table.Summary.Cell index={3}>
            {formatMilliseconds(totalTimeMs / totalNumberOfTasksAndAnnotations)}
          </Table.Summary.Cell>
          <Table.Summary.Cell index={4}> {formatMilliseconds(totalTimeMs)}</Table.Summary.Cell>
          <Table.Summary.Cell index={5} />
        </Table.Summary.Row>
      </>
    );
  };

  return (
    <Card
      title={"Annotation Time per User"}
      style={{
        marginTop: 30,
        marginBottom: 30,
      }}
    >
      <FilterOutlined />
      <ProjectAndAnnotationTypeDropdown
        setSelectedProjectIds={setSelectedProjectIds}
        selectedProjectIds={selectedProjectIds}
        setSelectedAnnotationType={setSelectedTypes}
        selectedAnnotationType={selectedTypes}
        selectedAnnotationState={selectedState}
        setSelectedAnnotationState={setSelectedState}
        style={{ ...filterStyle }}
      />
      <Select
        mode="multiple"
        placeholder="Filter teams"
        defaultValue={[]}
        disabled={!isCurrentUserAdminOrManager}
        style={{ width: 200, ...filterStyle }}
        options={allTeams.map((team) => {
          return {
            label: team.name,
            value: team.id,
          };
        })}
        value={selectedTeams}
        onSelect={(teamIdOrKey: string) => setSelectedTeams([...selectedTeams, teamIdOrKey])}
        onDeselect={(removedTeamId: string) => {
          setSelectedTeams(selectedTeams.filter((teamId) => teamId !== removedTeamId));
        }}
      />
      <RangePicker
        style={filterStyle}
        value={[startDate, endDate]}
        presets={rangePresets}
        onChange={(dates: [Dayjs | null, Dayjs | null] | null) => {
          if (dates == null || dates[0] == null || dates[1] == null) return;
          if (Math.abs(dates[0].diff(dates[1], "days")) > 3 * 31) {
            Toast.error(messages["timetracking.date_range_too_long"]);
            return;
          }
          setStartDate(dates[0].startOf("day"));
          setEndeDate(dates[1].endOf("day"));
        }}
      />
      <Spin spinning={isFetching} size="large">
        <FixedExpandableTable
          dataSource={filteredTimeEntries}
          rowKey="user"
          style={{
            marginTop: 30,
            marginBottom: 30,
          }}
          pagination={false}
          columns={timeTrackingTableColumns}
          expandable={{
            expandedRowRender: (entry) => (
              <TimeTrackingDetailView
                userId={entry.user.id}
                dateRange={[startDate.valueOf(), endDate.valueOf()]}
                annotationType={selectedTypes}
                annotationState={selectedState}
                projectIds={selectedProjectIds}
              />
            ),
          }}
          locale={{
            emptyText: renderPlaceholder(),
          }}
          summary={getSummaryRow}
        />
      </Spin>
      <Button
        type="primary"
        icon={<DownloadOutlined />}
        style={{ float: "right" }}
        onClick={() => exportToCSV()}
        disabled={filteredTimeEntries == null || filteredTimeEntries?.length === 0}
      >
        Export to CSV
      </Button>
    </Card>
  );
}

export default TimeTrackingOverview;
