import _ from "lodash";
import React from "react";
import { Table, Tag, Icon, Spin, Button } from "antd";
import Request from "libs/request";
import app from "app";
import Utils from "libs/utils";
import Toast from "libs/toast";
import TeamRoleModalView from "admin/views/user/team_role_modal_view";
import ExperienceModalView from "admin/views/user/experience_modal_view";
import TemplateHelpers from "libs/template_helpers";

const { Column } = Table;

class UserListView extends React.PureComponent {

  state = {
    isLoading: true,
    users: null,
    selectedUserIds: [],
    isExperienceModalVisible: false,
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

  handleExperienceChange = (updatedUsers) => {
    this.setState({
      user: updatedUsers,
      isExperienceModalVisible: false,
    });
  }

  render() {

    const hasRowsSelected = this.state.selectedUserIds.length > 0;
    const rowSelection = {
      onChange: (selectedUserIds, selectedUsers) => {
        this.setState({ selectedUserIds });
        console.log(`selectedUserIds: ${selectedUserIds}`, 'selectedUsers: ', selectedUsers);
      }
    };

    if (this.state.isLoading) {
      return <div className="text-center"><Spin size="large"/></div>;
    }

    return (<div className="user-administration-table container wide">
      <h3>Users</h3>

      { hasRowsSelected ? <span>{this.state.selectedUserIds.length} selected user(s)</span> : null}
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
      >
        <Column
          title="Last name"
          dataIndex="lastName"
          key="lastName"
          sorter={Utils.compareBy("lastName")}
        />
        <Column
          title="First name"
          dataIndex="firstName"
          key="firstName"
          sorter={Utils.compareBy("firstName")}
        />
        <Column
          title="Email"
          dataIndex="email"
          key="email"
          sorter={Utils.compareBy("email")}
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
          render={(teams, user) => teams.map((team) => (
            <span className="no-wrap" key={`team_role_${user.id}_${team.team}`}>
              {team.team} <Tag color={TemplateHelpers.stringToColor(team.role.name)}>{team.role.name}</Tag>
            </span>
          ))}
        />
        <Column
          title="Status"
          dataIndex="isActive"
          key="isActive"
          filters={[{ text: "Actived", value: "true" }]}
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
        users={_.clone(this.state.users)}
        onChange={this.handleExperienceChange}
        onCancel={() => this.setState({isExperienceModalVisible: false}) }
      />
    </div>)
  }
}

export default UserListView;
