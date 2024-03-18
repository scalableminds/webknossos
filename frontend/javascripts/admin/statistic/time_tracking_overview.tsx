import { getProjects, getTeams } from "admin/admin_rest_api";
import { Card, Select, Spin, Table, Button, DatePicker, type TimeRangePickerProps } from "antd";
import Request from "libs/request";
import { useFetch } from "libs/react_helpers";
import _ from "lodash";
import React, { useEffect, useState } from "react";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import { DownloadOutlined, FilterOutlined } from "@ant-design/icons";
import saveAs from "file-saver";
import { formatMilliseconds } from "libs/format_utils";
import { Link } from "react-router-dom";
import ProjectAndAnnotationTypeDropdown from "./project_and_annotation_type_dropdown";
import { isUserAdminOrTeamManager } from "libs/utils";
import messages from "messages";
import Toast from "libs/toast";
import { useSelector } from "react-redux";
import { OxalisState } from "oxalis/store";

export enum AnnotationTypeFilterEnum {
  ONLY_ANNOTATIONS_KEY = "Explorational",
  ONLY_TASKS_KEY = "Task",
  TASKS_AND_ANNOTATIONS_KEY = "Task,Explorational",
}
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
  const getTimeEntryUrl = (
    startMs: number,
    endMs: number,
    teamIds: string[],
    projectIds: string[],
  ) => {
    // Omit project parameter in request if annotation data is requested
    const projectsParam = projectIds.length > 0 ? `&projectIds=${projectIds.join(",")}` : "";
    return `api/time/overview?start=${startMs}&end=${endMs}&annotationTypes=${selectedTypes}&teamIds=${teamIds.join(
      ",",
    )}${projectsParam}`;
  };

  const currentTime = dayjs();
  const [startDate, setStartDate] = useState(currentTime.startOf("month"));
  const [endDate, setEndeDate] = useState(currentTime);
  const [isFetching, setIsFetching] = useState(false);
  const mayUserAccessView = useSelector(
    (state: OxalisState) => {
      const activeUser = state.activeUser;
      return activeUser != null && isUserAdminOrTeamManager(activeUser);
    }
  );
  const [allTeams, allProjects] = useFetch(
    async () => {
      if (!mayUserAccessView) return [[], [], []];
      setIsFetching(true);
      const [allTeams, allProjects] = await Promise.all([getTeams(), getProjects()]);
      setIsFetching(false);
      return [allTeams, allProjects];
    },
    [[], [], []],
    [mayUserAccessView],
  );

  const [selectedProjectIds, setSelectedProjectIds] = useState(Array<string>);
  const [selectedTypes, setSelectedTypes] = useState(
    AnnotationTypeFilterEnum.TASKS_AND_ANNOTATIONS_KEY,
  );
  const [selectedTeams, setSelectedTeams] = useState(allTeams.map((team) => team.id));
  const [projectOrTypeQueryParam, setProjectOrTypeQueryParam] = useState("");
  useEffect(() => {
    if (selectedProjectIds.length > 0 && selectedProjectIds.length < allProjects.length) {
      setProjectOrTypeQueryParam(selectedProjectIds.join(","));
    } else {
      setProjectOrTypeQueryParam(selectedTypes);
    }
  }, [selectedProjectIds, selectedTypes, allProjects.length]);
  const filteredTimeEntries = useFetch(
    async () => {
      if (!mayUserAccessView) return []; // TODO i dont know whether there is a nicer way to deal with this, other components seem to handle it similarly
      setIsFetching(true);
      const filteredTeams =
        selectedTeams.length === 0 ? allTeams.map((team) => team.id) : selectedTeams;
      if (filteredTeams.length === 0) return;
      const projectFilterNeeded = selectedTypes === AnnotationTypeFilterEnum.ONLY_TASKS_KEY;
      let filteredProjects = selectedProjectIds;
      if (projectFilterNeeded && selectedProjectIds.length === 0)
        // If timespans for all tasks should be shown, all project ids need to be passed in the request.
        filteredProjects = allProjects.map((project) => project.id);
      const timeEntriesURL = getTimeEntryUrl(
        startDate.valueOf(),
        endDate.valueOf(),
        filteredTeams,
        filteredProjects,
      );
      const filteredEntries: TimeEntry[] = await Request.receiveJSON(timeEntriesURL);
      setIsFetching(false);
      return filteredEntries;
    },
    [],
    [
      selectedTeams,
      selectedTypes,
      selectedProjectIds,
      startDate,
      endDate,
      mayUserAccessView,
      allTeams,
      allProjects
    ],
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
        // TODO fix type error. see time_line_view: type error is commented out.
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
  );
}

export default TimeTrackingOverview;
