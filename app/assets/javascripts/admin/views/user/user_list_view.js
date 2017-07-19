import _ from "lodash";
import React from "react";
import { Table, Tag, Icon, Spin } from "antd";
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
  }

  componentDidMount() {
    this.fetchData();
  }

  async fetchData(): Promise<void> {
    const url = "/api/users?isEditable=true";
    const users = await Request.receiveJSON(url);

    this.setState({
      isLoading: false,
      selectedRows: [],
      users,
     });
  }

  onSelectChange = (selectedRowKeys) => {
    console.log('selectedRowKeys changed: ', selectedRowKeys);
    this.setState({ selectedRowKeys });
  }

  render() {

    const rowSelection = {
      onChange: (selectedRowKeys, selectedRows) => {
        console.log(`selectedRowKeys: ${selectedRowKeys}`, 'selectedRows: ', selectedRows);
      },
      getCheckboxProps: record => ({
        disabled: record.name === 'Disabled User',    // Column configuration not to be checked
      }),
    };

    if (this.state.isLoading) {
      return <div className="text-center"><Spin size="large"/></div>;
    }

    return (<div className="user-administration-table container wide">
      <h3>Users</h3>

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
          render={(experiences) =>
            _.map(experiences, (value, domain, i) =>
              <Tag key={`experience_${i}`}>{domain} : {value}</Tag>
            )
          }
        />
        <Column
          title="Teams - Role"
          dataIndex="teams"
          key="teams_"
          render={(teams) => teams.map((team, i) => (
            <span className="no-wrap" key={`team_role_${i}`}>
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
                <a href="#" onClick={this.deactivateUser}><Icon type="lock" />Deactivate User</a> :
                <a href="#" onClick={this.activateUser}><Icon type="unlock" />Activate User</a>
              }
            </span>
          )}
        />
      </Table>
    </div>)
  }
}

export default UserListView;
