import { getProjects, getTeams } from "admin/admin_rest_api";
import { Card, Select, Spin, Table, DatePicker } from "antd";
import Request from "libs/request";
import { useFetch } from "libs/react_helpers";
import _ from "lodash";
import React, { useState } from "react";
import * as Utils from "libs/utils";
import dayjs from "dayjs";

const { Column } = Table;
const { RangePicker } = DatePicker;

type TimeEntry = {
  user: {
    id: string;
    firstName: string;
    lastName: string;
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

  // TODO fix dates
  const currentTime = dayjs();
  //const [filteredTimeRange, setFilteredTimeRange] = useState();
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
      if (selectedTeams.length > 0 && selectedProjects.length > 0) {
        const timeEntriesURL = getTimeEntryUrl(
          startDate.valueOf(),
          endDate.valueOf(),
          selectedTeams,
          selectedProjects,
        );
        const filteredEntries: TimeEntry[] = await Request.receiveJSON(timeEntriesURL);
        return filteredEntries;
      }
    },
    allTimeEntries,
    [selectedTeams, selectedProjects, startDate, endDate],
  ); // TODO dependencies are multi selection
  const filterStyle = { marginInline: 10 };
  const selectWidth = 200;
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
      <Spin spinning={false} size="large">
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
          />
          <Column
            title="Time"
            dataIndex="timeMillis"
            key="tracingTimes"
            render={(tracingTimeInMs) => {
              const minutes = tracingTimeInMs / 1000 / 60;
              const hours = Utils.zeroPad(Math.floor(minutes / 60));
              const remainingMinutes = Utils.zeroPad(Math.floor(minutes % 60));
              return `${hours}h ${remainingMinutes}m`;
            }}
          />
          <Column title="Details" key="details" />{" "}
        </Table>
        {/* render word "details" and link to https://webknossos.org/reports/timetracking (vorausgefüllt)*/}
      </Spin>
    </Card>
  );
}

export default TimeTrackingOverview;
