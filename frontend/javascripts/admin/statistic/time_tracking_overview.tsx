import { getProjects, getTeams } from "admin/admin_rest_api";
import { Card, Select, Spin, Table } from "antd";
import Request from "libs/request";
import { useFetch } from "libs/react_helpers";
import _ from "lodash";
import React, { useState } from "react";

const { Column } = Table;

function TimeTrackingOverview() {
  // TODO make sure this is resolved
  const allTeams = useFetch(async () => await getTeams(), [], []);
  const allProjects = useFetch(async () => await getProjects(), [], []);

  const currentTime = new Date();
  // TODO fix dates
  const [startDate, setStartDate] = useState(new Date().setDate(currentTime.getDate() - 7));
  const [endDate, setEndeDate] = useState(currentTime.getTime());
  const timeEntries = useFetch(
    async () => {
      const timeEntriesURL = `api/time/summed/userList?start=${startDate}&end=${endDate}
      )}&onlyCountTasks=false&teamIds=${allTeams
        .map((team) => team.id)
        .join(",")}&projectIds=${allProjects.map((project) => project.id).join(",")}`;
      return await Request.receiveJSON(timeEntriesURL);
    },
    [],
    [],
  );
  const selectStyle = { width: 200, marginInline: 10 };
  return (
    <Card
      title={`Annotation Time per User`}
      style={{
        marginTop: 30,
        marginBottom: 30,
      }}
    >
      <Select
        mode="multiple"
        placeholder="Filter team"
        defaultValue={[]}
        style={selectStyle}
        options={allTeams.map((team) => {
          return {
            label: team.name,
            value: team.name,
          };
        })}
      />
      <Select
        mode="multiple"
        placeholder="Filter projects"
        defaultValue={[]}
        style={selectStyle}
        options={allProjects.map((project) => {
          return {
            label: project.name,
            value: project.name,
          };
        })}
      />
      <Spin spinning={false} size="large">
        <Table></Table>
        {/* <Table
          dataSource={this.state.timeEntries}
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
            dataIndex="tracingTimes"
            key="tracingTimes"
            render={(tracingTimes: TimeEntry[]) => {
              const duration = _.sumBy(tracingTimes, (timeEntry) => timeEntry.tracingTime);

              const minutes = duration / 1000 / 60;
              const hours = Utils.zeroPad(Math.floor(minutes / 60));
              const remainingMinutes = Utils.zeroPad(Math.floor(minutes % 60));
              return `${hours}h ${remainingMinutes}m`;
            }}
          />
          <Column title="Details" key="details" />{" "}
          {/* render word "details" and link to https://webknossos.org/reports/timetracking (vorausgefüllt)
        </Table>
        */}
      </Spin>
    </Card>
  );
}

export default TimeTrackingOverview;
