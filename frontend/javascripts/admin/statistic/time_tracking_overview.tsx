import { getProjects, getTeams, getTimeEntries } from "admin/admin_rest_api";
import { Card, Select, Spin, Table, Button, DatePicker, type TimeRangePickerProps } from "antd";
import { useFetch } from "libs/react_helpers";
import _ from "lodash";
import React, { useEffect, useState } from "react";
import { DownloadOutlined, FilterOutlined } from "@ant-design/icons";
import saveAs from "file-saver";
import { formatMilliseconds } from "libs/format_utils";
import { Link } from "react-router-dom";
import ProjectAndAnnotationTypeDropdown, {
  AnnotationTypeFilterEnum,
} from "./project_and_annotation_type_dropdown";
import { isUserAdminOrTeamManager } from "libs/utils";
import messages from "messages";
import Toast from "libs/toast";
import { useSelector } from "react-redux";
import { OxalisState } from "oxalis/store";
import dayjs, { Dayjs } from "antd/node_modules/dayjs";
const { Column } = Table;
const { RangePicker } = DatePicker;

const TIMETRACKING_CSV_HEADER = ["userId,userFirstName,userLastName,timeTrackedInSeconds"];

type TimeEntry = {
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  timeMillis: number;
};

function TimeTrackingOverview() {
  const currentTime = dayjs();
  const [startDate, setStartDate] = useState(currentTime.startOf("month"));
  const [endDate, setEndeDate] = useState(currentTime);
  const [isFetching, setIsFetching] = useState(false);
  const mayUserAccessView = useSelector((state: OxalisState) => {
    const activeUser = state.activeUser;
    return activeUser != null && isUserAdminOrTeamManager(activeUser);
  });
  const [allTeams, numberOfAllProjects] = useFetch(
    async () => {
      setIsFetching(true);
      const [allTeams, allProjects] = await Promise.all([getTeams(), getProjects()]);
      setIsFetching(false);
      return [allTeams, allProjects.length];
    },
    [[], 0],
    [],
  );

  const [selectedProjectIds, setSelectedProjectIds] = useState(Array<string>);
  const [selectedTypes, setSelectedTypes] = useState(
    AnnotationTypeFilterEnum.TASKS_AND_ANNOTATIONS_KEY,
  );
  const [selectedTeams, setSelectedTeams] = useState(allTeams.map((team) => team.id));
  const [projectOrTypeQueryParam, setProjectOrTypeQueryParam] = useState("");
  useEffect(() => {
    if (selectedProjectIds.length > 0 && selectedProjectIds.length < numberOfAllProjects) {
      setProjectOrTypeQueryParam(selectedProjectIds.join(","));
    } else {
      setProjectOrTypeQueryParam(selectedTypes);
    }
  }, [selectedProjectIds, selectedTypes, numberOfAllProjects]);
  const filteredTimeEntries = useFetch(
    async () => {
      setIsFetching(true);
      const filteredEntries: TimeEntry[] = await getTimeEntries(
        startDate.valueOf(),
        endDate.valueOf(),
        selectedTeams,
        selectedTypes,
        selectedProjectIds,
      );
      setIsFetching(false);
      return filteredEntries;
    },
    [],
    [selectedTeams, selectedTypes, selectedProjectIds, startDate, endDate],
  );
  const filterStyle = { marginInline: 10 };

  const exportToCSV = () => {
    if (filteredTimeEntries == null || filteredTimeEntries.length === 0) {
      return;
    }
    const timeEntriesAsString = filteredTimeEntries
      .map((row) => {
        return [
          row.user.id,
          row.user.firstName,
          row.user.lastName,
          Math.round(row.timeMillis / 1000),
        ]
          .map(String) // convert every value to String
          .map((v) => v.replaceAll('"', '""')) // escape double quotes
          .map((v) => (v.includes(",") || v.includes('"') ? `"${v}"` : v)) // quote it if necessary
          .join(","); // comma-separated
      })
      .join("\n"); // rows starting on new lines
    const csv = [TIMETRACKING_CSV_HEADER, timeEntriesAsString].join("\n");
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
        There is no user activity recorded for the selected time span. Please adjust the time
        settings and filters above.
      </p>
    );
  };

  return mayUserAccessView ? (
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
        style={{ ...filterStyle }}
      />
      <Select
        mode="multiple"
        placeholder="Filter teams"
        defaultValue={[]}
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
        onChange={(dates: null | (Dayjs | null)[]) => {
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
        <Table
          dataSource={filteredTimeEntries}
          rowKey={(entry) => entry.user.id}
          style={{
            marginTop: 30,
            marginBottom: 30,
          }}
          pagination={false}
          locale={{
            emptyText: renderPlaceholder(),
          }}
        >
          <Column
            title="User"
            dataIndex="user"
            key="user"
            render={(user) => `${user.lastName}, ${user.firstName} (${user.email})`}
            sorter={true}
          />
          <Column
            title="Time"
            dataIndex="timeMillis"
            key="tracingTimes"
            render={(tracingTimeInMs) => formatMilliseconds(tracingTimeInMs)}
            sorter={true}
          />
          <Column
            key="details"
            dataIndex="user"
            render={(user) => {
              const params = new URLSearchParams();
              params.append("user", user.id);
              params.append("start", startDate.valueOf().toString());
              params.append("end", endDate.valueOf().toString());
              params.append("projectsOrType", projectOrTypeQueryParam);
              return <Link to={`/reports/timetracking?${params}`}>Details</Link>;
            }}
          />
        </Table>
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
  ) : (
    <>Sorry, you are not allowed to see this view.</>
  );
}

export default TimeTrackingOverview;
