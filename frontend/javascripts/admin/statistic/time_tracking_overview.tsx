import { getProjects, getTeams } from "admin/admin_rest_api";
import { Card, Select, Spin, Table, Button, DatePicker, TimeRangePickerProps } from "antd";
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
import { APIProject } from "types/api_flow_types";

const { Column } = Table;
const { RangePicker } = DatePicker;

const TIMETRACKING_CSV_HEADER = ["userId,userFirstName,userLastName,timeTrackedInSeconds"];
export enum typeFilters {
  ONLY_ANNOTATIONS_KEY = "Explorational",
  ONLY_TASKS_KEY = "Task",
  TASKS_AND_ANNOTATIONS_KEY = "Task,Explorational",
}
type TypeFilters = "Explorational" | "Task" | "Task,Explorational";

type TimeEntry = {
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  timeMillis: number;
};

export const getTaskFilterOptions = (allProjects: APIProject[]) => {
  const additionalProjectFilters = {
    label: "Filter types",
    options: [
      { label: "Tasks & Annotations", value: typeFilters.TASKS_AND_ANNOTATIONS_KEY },
      { label: "Annotations", value: typeFilters.ONLY_ANNOTATIONS_KEY },
      { label: "Tasks", value: typeFilters.ONLY_TASKS_KEY },
    ],
  };
  const mappedProjects = allProjects.map((project) => {
    return {
      label: project.name,
      value: project.id,
    };
  });
  return [
    additionalProjectFilters,
    { label: "Filter projects (only tasks)", options: mappedProjects },
  ];
};

function TimeTrackingOverview() {
  const getTimeEntryUrl = (
    startMs: number,
    endMs: number,
    teamIds: string[],
    projectIds: string[],
  ) => {
    // omit project parameter in request if annotation data is requested
    const projectsParam = projectIds.length > 0 ? `&projectIds=${projectIds.join(",")}` : "";
    return `api/time/summed/userList?start=${startMs}&end=${endMs}&annotationTypes=${selectedTypes}&teamIds=${teamIds.join(
      ",",
    )}${projectsParam}`;
  };

  const currentTime = dayjs();
  const [startDate, setStartDate] = useState(currentTime.startOf("month"));
  const [endDate, setEndeDate] = useState(currentTime);
  // TODO make sure this is resolved
  const [allTeams, allProjects, allTimeEntries] = useFetch(
    async () => {
      const [allTeams, allProjects] = await Promise.all([getTeams(), getProjects()]);
      const timeEntriesURL = getTimeEntryUrl(
        startDate.valueOf(),
        endDate.valueOf(),
        allTeams.map((team) => team.id),
        allProjects.map((projects) => projects.id),
      );
      const allTimeEntries: TimeEntry[] = await Request.receiveJSON(timeEntriesURL);
      return [allTeams, allProjects, allTimeEntries];
    },
    [[], [], []],
    [],
  );

  const [selectedProjectIds, setSelectedProjectIds] = useState(Array<string>);
  const [selectedTypes, setSelectedTypes] = useState("Task,Explorational");
  const [selectedProjectOrTypeFilters, setSelectedProjectOrTypeFilters] = useState(Array<string>);
  useEffect(
    () => setSelectedProjectOrTypeFilters([...selectedProjectIds, selectedTypes]),
    [selectedProjectIds, selectedTypes],
  );
  const [selectedTeams, setSelectedTeams] = useState(allTeams.map((team) => team.id));
  const filteredTimeEntries = useFetch(
    async () => {
      const filteredTeams =
        selectedTeams.length === 0 ? allTeams.map((team) => team.id) : selectedTeams;
      const projectFilterNeeded = selectedTypes === typeFilters.ONLY_TASKS_KEY;
      let filteredProjects = selectedProjectIds;
      if (projectFilterNeeded && selectedProjectIds.length === 0)
        filteredProjects = allProjects.map((project) => project.id);
      //TODO make sure its working for project id list length 0
      const timeEntriesURL = getTimeEntryUrl(
        startDate.valueOf(),
        endDate.valueOf(),
        filteredTeams,
        filteredProjects,
      );
      const filteredEntries: TimeEntry[] = await Request.receiveJSON(timeEntriesURL);
      return filteredEntries;
    },
    allTimeEntries,
    [selectedTeams, selectedProjectOrTypeFilters, startDate, endDate, allTimeEntries],
  );
  const filterStyle = { marginInline: 10 };
  const selectWidth = 200;

  const exportToCSV = () => {
    if (filteredTimeEntries.length === 0) {
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

  //TODO make new after proper request for annotations only
  const setSelectedProjects = (_prevSelection: string[], selectedValue: string) => {
    if (Object.values<string>(typeFilters).includes(selectedValue)) {
      setSelectedTypes(selectedValue);
      setSelectedProjectIds([]);
    } else {
      setSelectedTypes(typeFilters.ONLY_TASKS_KEY);
      setSelectedProjectIds([...selectedProjectIds, selectedValue]);
    }
  };

  const onDeselect = (removedKey: string) => {
    if ((Object.values(typeFilters) as string[]).includes(removedKey)) {
      setSelectedProjectOrTypeFilters([typeFilters.TASKS_AND_ANNOTATIONS_KEY]);
    } else {
      setSelectedProjectOrTypeFilters(
        selectedProjectOrTypeFilters.filter((projectId) => projectId !== removedKey),
      );
    }
  };

  // TODO fix range preselects
  const rangePresets: TimeRangePickerProps["presets"] = [
    { label: "Last 7 Days", value: [dayjs().subtract(7, "d"), dayjs()] },
    { label: "Last 30 Days", value: [dayjs().subtract(30, "d"), dayjs()] },
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
      <Select
        mode="multiple"
        placeholder="Filter type or projects"
        style={{ width: selectWidth, ...filterStyle }}
        options={getTaskFilterOptions(allProjects)}
        value={selectedProjectOrTypeFilters} //make two datastructures and merge with useEffect
        onDeselect={(removedProjectId: string) => onDeselect(removedProjectId)}
        onSelect={(projectId: string) =>
          setSelectedProjects(selectedProjectOrTypeFilters, projectId)
        }
      />
      <Select
        mode="multiple"
        placeholder="Filter teams"
        defaultValue={[]}
        style={{ width: selectWidth, ...filterStyle }}
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
          if (dates == null) return;
          dates[0] != null && setStartDate(dates[0]);
          dates[1] != null && setEndeDate(dates[1]);
        }}
      />
      <Spin spinning={false} size="large">
        {/* fix me */}
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
              params.append("projectsOrType", selectedProjectOrTypeFilters.join());
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
      >
        Export to CSV
      </Button>
    </Card>
  );
}

export default TimeTrackingOverview;
