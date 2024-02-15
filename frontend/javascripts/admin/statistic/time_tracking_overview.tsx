import { getProjects, getTeams } from "admin/admin_rest_api";
import { Card, Select, Spin, Table, DatePicker, Button } from "antd";
import Request from "libs/request";
import { useFetch } from "libs/react_helpers";
import _ from "lodash";
import React, { useState } from "react";
import dayjs from "dayjs";
import { DownloadOutlined } from "@ant-design/icons";
import saveAs from "file-saver";
import { formatMilliseconds } from "libs/format_utils";

const { Column } = Table;
const { RangePicker } = DatePicker;

const TIMETRACKING_CSV_HEADER = ["userId,userFirstName,userLastName,timeTracked"];

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
    return `api/time/summed/userList?start=${startMs}&end=${endMs}&onlyCountTasks=false&teamIds=${teamIds.join(
      ",",
    )}&projectIds=${projectIds.join(",")}`;
  };

  const currentTime = dayjs();
  const [startDate, setStartDate] = useState(currentTime.subtract(7, "d"));
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

  const [selectedProjects, setSelectedProjects] = useState(allProjects.map((p) => p.id));
  const [selectedTeams, setSelectedTeams] = useState(allTeams.map((team) => team.id));

  const filteredTimeEntries = useFetch(
    async () => {
      const filteredTeams =
        selectedTeams.length > 0 ? selectedTeams : allTeams.map((team) => team.id);
      const filteredProjects =
        selectedProjects.length > 0 ? selectedProjects : allProjects.map((project) => project.id);
      if (filteredTeams.length < 1 || filteredProjects.length < 1) return [];
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
    [selectedTeams, selectedProjects, startDate, endDate, allTimeEntries],
  );
  const filterStyle = { marginInline: 10 };
  const selectWidth = 200;

  const exportToCSV = () => {
    if (filteredTimeEntries.length === 0) {
      return;
    }
    const timeEntriesAsString = filteredTimeEntries
      .map(
        (row) =>
          [row.user.id, row.user.firstName, row.user.lastName, formatMilliseconds(row.timeMillis)]
            .map(String) // convert every value to String
            .map((v) => v.replaceAll('"', '""')) // escape double quotes
            .map((v) => (v.includes(",") || v.includes('"') ? `"${v}"` : v)) // quote it if necessary
            .join(","), // comma-separated
      )
      .join("\n"); // rows starting on new lines
    const csv = [TIMETRACKING_CSV_HEADER, timeEntriesAsString].join("\n");
    const filename = "timetracking-export.csv";
    const blob = new Blob([csv], {
      type: "text/plain;charset=utf-8",
    });
    saveAs(blob, filename);
  };

  return (
    <Card
      title={"Annotation Time per User"}
      style={{
        marginTop: 30,
        marginBottom: 30,
      }}
    >
      <Select
        mode="multiple"
        placeholder="Filter team"
        defaultValue={[]}
        style={{ width: selectWidth, ...filterStyle }}
        options={allTeams.map((team) => {
          return {
            label: team.name,
            value: team.id,
          };
        })}
        value={selectedTeams}
        onSelect={(teamId: string) => setSelectedTeams([...selectedTeams, teamId])}
        onDeselect={(removedTeamId: string) =>
          setSelectedTeams(selectedTeams.filter((teamId) => teamId !== removedTeamId))
        }
      />
      <Select
        mode="multiple"
        placeholder="Filter projects"
        defaultValue={[]}
        style={{ width: selectWidth, ...filterStyle }}
        options={allProjects.map((project) => {
          return {
            label: project.name,
            value: project.id,
          };
        })}
        value={selectedProjects}
        onDeselect={(removedProjectId: string) =>
          setSelectedProjects(
            selectedProjects.filter((projectId) => projectId !== removedProjectId),
          )
        }
        onSelect={(projectId: string) => setSelectedProjects([...selectedProjects, projectId])}
      />
      <RangePicker
        style={filterStyle}
        value={[startDate, endDate]}
        onChange={(dates, _dateStrings) => {
          setStartDate(dates[0]);
          setEndeDate(dates[1]);
        }}
      />
      <Spin spinning={allTimeEntries.length < 1} size="large">
        {" "}
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
          <Column title="Details" key="details" />{" "}
        </Table>
        {/* render word "details" and link to https://webknossos.org/reports/timetracking (vorausgefüllt)*/}
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
