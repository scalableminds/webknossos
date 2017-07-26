// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import _ from "lodash";
import React from "react";
import { Table, Tag, Icon, Spin, Button } from "antd";
import Request from "libs/request";
import TeamRoleModalView from "admin/views/user/team_role_modal_view";
import ExperienceModalView from "admin/views/user/experience_modal_view";
import TemplateHelpers from "libs/template_helpers";
import type { APIUserType } from "admin/api_flow_types";

const { Column } = Table;

class UserListView extends React.PureComponent {

  state: {
    isLoading: boolean,
    users: ?Array<APIUserType>,
    selectedUserIds: Array<string>,
    isExperienceModalVisible: boolean,
    isTeamRoleModalVisible: boolean,
  } = {
    isLoading: true,
    users: null,
    selectedUserIds: [],
    isExperienceModalVisible: false,
    isTeamRoleModalVisible: false,
  }

  componentDidMount() {
    this.fetchData();
  }

  async fetchData(): Promise<void> {
    const url = "/api/users?isEditable=true";
    const users = await Request.receiveJSON(url);

    this.setState({
      isLoading: false,
      users,
     });
  }

  activateUser = () => {}

  deactivateUser = () => {}

  handleUsersChange = (updatedUsers: Array<APIUserType>) => {
    this.setState({
      users: updatedUsers,
      isExperienceModalVisible: false,
      isTeamRoleModalVisible: false,
    });
  }

  render() {
    const compareFunc = (attribute: string) =>
      (a: Object, b: Object) =>
        a[attribute].toLowerCase().localeCompare(b[attribute].toLowerCase());

    const hasRowsSelected = this.state.selectedUserIds.length > 0;
    const rowSelection = {
      onChange: (selectedUserIds) => {
        this.setState({ selectedUserIds });
      }
    };

    if (this.state.isLoading) {
      return <div className="text-center"><Spin size="large"/></div>;
    }

    const marginRight = { marginRight: 20 };

    return (<div className="user-administration-table container wide">
      <h3>Users</h3>

      { hasRowsSelected ? <span style={marginRight}>{this.state.selectedUserIds.length} selected user(s)</span> : null}
      <Button
        onClick={() => this.setState({isTeamRoleModalVisible: true}) }
        icon="team"
        disabled={!hasRowsSelected}
        style={marginRight}>
        Edit Teams
      </Button>
      <Button
        onClick={() => this.setState({isExperienceModalVisible: true}) }
        icon="trophy"
        disabled={!hasRowsSelected}>
        Change Experience
      </Button>

      <Table
        dataSource={this.state.users}
        rowKey="id"
        rowSelection={rowSelection}
        pagination={{
          defaultPageSize: 50,
        }}
        style={{marginTop: 30, marginBotton: 30}}
      >
        <Column
          title="Last name"
          dataIndex="lastName"
          key="lastName"
          sorter={compareFunc("lastName")}
        />
        <Column
          title="First name"
          dataIndex="firstName"
          key="firstName"
          sorter={compareFunc("firstName")}
        />
        <Column
          title="Email"
          dataIndex="email"
          key="email"
          sorter={compareFunc("email")}
        />
        <Column
          title="Experiences"
          dataIndex="experiences"
          key="experiences"
          render={(experiences, user) =>
            _.map(experiences, (value, domain) =>
              <Tag key={`experience_${user.id}_${domain}`}>{domain} : {value}</Tag>
            )
          }
        />
        <Column
          title="Teams - Role"
          dataIndex="teams"
          key="teams_"
          render={(teams, user) => teams.map((team) =>
            <span className="nowrap" key={`team_role_${user.id}_${team.team}`}>
              {team.team} <Tag color={TemplateHelpers.stringToColor(team.role.name)}>{team.role.name}</Tag>
            </span>
          )}
        />
        <Column
          title="Status"
          dataIndex="isActive"
          key="isActive"
          filters={[{ text: "Actived", value: "true" }, { text: "Deactived", value: "false" }]}
          filtered
          onFilter={(value, record) => record.isActive.toString() === value}
          render={(isActive) => {
            const icon = isActive ? "check-circle-o" : "close-circle-o";
            return <Icon type={icon} style={{ fontSize: 20 }}/>
          }
        }
        />
        <Column
          title="Actions"
          key="actions"
          render={(__, record) => (
            <span>
              <a href={`/users/${record.id}/details`}><Icon type="user" />Show Tracings</a><br />
              <a href={`/api/users/${record.id}/annotations/download`} title="download all finished tracings"><Icon type="download" />Download</a><br />
              { record.isActive ?
                <a href="#" onClick={this.deactivateUser}><Icon type="user-delete" />Deactivate User</a> :
                <a href="#" onClick={this.activateUser}><Icon type="user-add" />Activate User</a>
              }
            </span>
          )}
        />
      </Table>
      <ExperienceModalView
        visible={this.state.isExperienceModalVisible}
        selectedUserIds={this.state.selectedUserIds}
        users={this.state.users || []}
        onChange={this.handleUsersChange}
        onCancel={() => this.setState({isExperienceModalVisible: false}) }
      />
      <TeamRoleModalView
        visible={this.state.isTeamRoleModalVisible}
        selectedUserIds={this.state.selectedUserIds}
        users={this.state.users || []}
        onChange={this.handleUsersChange}
        onCancel={() => this.setState({isTeamRoleModalVisible: false}) }
      />
    </div>)
  }
}

export default UserListView;
