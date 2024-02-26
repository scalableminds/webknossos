import { getProjects, getTeams } from "admin/admin_rest_api";
import { Card, Select, Spin, Table, Button } from "antd";
import Request from "libs/request";
import { useFetch } from "libs/react_helpers";
import _ from "lodash";
import React, { useState } from "react";
import dayjs from "dayjs";
import { DownloadOutlined, FilterOutlined } from "@ant-design/icons";
import saveAs from "file-saver";
import { formatMilliseconds } from "libs/format_utils";
import { Link } from "react-router-dom";
import generatePicker from "antd/es/date-picker/generatePicker";
import dayjsGenerateConfig from "rc-picker/lib/generate/dayjs";
import { APIProject } from "types/api_flow_types";

const { Column } = Table;
const DatePicker = generatePicker(dayjsGenerateConfig);
const { RangePicker } = DatePicker;

const TIMETRACKING_CSV_HEADER = ["userId,userFirstName,userLastName,timeTrackedInSeconds"];
export enum typeFilters {
  ONLY_ANNOTATIONS_KEY = "ONLY_ANNOTATIONS",
  ONLY_TASKS_KEY = "ONLY_TASKS",
  TASKS_AND_ANNOTATIONS_KEY = "TASKS_AND_ANNOTATIONS",
}

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
    return `api/time/summed/userList?start=${startMs}&end=${endMs}&onlyCountTasks=${onlyTasks}&teamIds=${teamIds.join(
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

  const [selectedProjectIds, setSelectedProjectIds] = useState([
    typeFilters.TASKS_AND_ANNOTATIONS_KEY as string,
  ]);
  const [selectedTeams, setSelectedTeams] = useState(allTeams.map((team) => team.id));
  const [onlyTasks, setOnlyTasks] = useState(false);

  const filteredTimeEntries = useFetch(
    async () => {
      const filteredTeams =
        selectedTeams.length === 0 ? allTeams.map((team) => team.id) : selectedTeams;
      let filteredProjects =
        selectedProjectIds.length === 0 || selectedProjectIds.includes(typeFilters.ONLY_TASKS_KEY)
          ? allProjects.map((project) => project.id)
          : selectedProjectIds;
      const selectAll = selectedProjectIds.includes(typeFilters.TASKS_AND_ANNOTATIONS_KEY);
      if (selectAll) filteredProjects = [];
      if (filteredTeams.length < 1 || (filteredProjects.length < 1 && !selectAll)) return [];
      if (selectedProjectIds.includes(typeFilters.ONLY_ANNOTATIONS_KEY)) {
        console.log("Not yet implemented");
        return [];
      }
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
    [selectedTeams, selectedProjectIds, startDate, endDate, allTimeEntries],
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
  const setSelectedProjects = (selectedProjectIds: string[], projectId: string) => {
    if (projectId == typeFilters.TASKS_AND_ANNOTATIONS_KEY) {
      setSelectedProjectIds([typeFilters.TASKS_AND_ANNOTATIONS_KEY]);
      setOnlyTasks(false);
    } // set all projects and true
    else if (projectId == typeFilters.ONLY_TASKS_KEY) {
      setSelectedProjectIds([typeFilters.ONLY_TASKS_KEY]);
      setOnlyTasks(true);
    } else if (projectId == typeFilters.ONLY_ANNOTATIONS_KEY) {
      setSelectedProjectIds([typeFilters.ONLY_ANNOTATIONS_KEY]);
      setOnlyTasks(false);
    } else {
      const prevSelectedIds = selectedProjectIds.filter(
        (id) => !(Object.values(typeFilters) as string[]).includes(id),
      );
      setSelectedProjectIds([...prevSelectedIds, projectId]);
    }
  };

  const onDeselect = (removedKey: string) => {
    if ((Object.values(typeFilters) as string[]).includes(removedKey)) {
      setSelectedProjectIds([typeFilters.TASKS_AND_ANNOTATIONS_KEY]);
    } else {
      setSelectedProjectIds(selectedProjectIds.filter((projectId) => projectId !== removedKey));
    }
  };

  // TODO fix range preselects
  const rangePresets = [
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
        options={getTaskFilterOptions()}
        value={selectedProjectIds}
        onDeselect={(removedProjectId: string) => onDeselect(removedProjectId)}
        onSelect={(projectId: string) => setSelectedProjects(selectedProjectIds, projectId)}
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
        onChange={(dates, _dateStrings) => {
          if (dates == null) return;
          setStartDate(dates[0]);
          setEndeDate(dates[1]);
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
