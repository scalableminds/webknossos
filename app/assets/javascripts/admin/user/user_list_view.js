// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import _ from "lodash";
import * as React from "react";
import { connect } from "react-redux";
import { Link, withRouter } from "react-router-dom";
import { Table, Tag, Icon, Spin, Button, Input, Modal } from "antd";
import TeamRoleModalView from "admin/user/team_role_modal_view";
import ExperienceModalView from "admin/user/experience_modal_view";
import TemplateHelpers from "libs/template_helpers";
import Utils from "libs/utils";
import { getEditableUsers, updateUser } from "admin/admin_rest_api";
import Persistence from "libs/persistence";
import { PropTypes } from "@scalableminds/prop-types";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import messages from "messages";

import type { APIUserType, APITeamMembershipType, ExperienceMapType } from "admin/api_flow_types";
import type { RouterHistory } from "react-router-dom";
import type { OxalisState } from "oxalis/store";
import EditableTextLabel from "oxalis/view/components/editable_text_label";
import Toast from "libs/toast";
import Store from "../../oxalis/store";
import { logoutUserAction } from "../../oxalis/model/actions/user_actions";

const { Column } = Table;
const { Search } = Input;

const typeHint: APIUserType[] = [];

type StateProps = {
  activeUser: APIUserType,
};

type Props = {
  history: RouterHistory,
} & StateProps;

type State = {
  isLoading: boolean,
  users: Array<APIUserType>,
  selectedUserIds: Array<string>,
  isExperienceModalVisible: boolean,
  isTeamRoleModalVisible: boolean,
  activationFilter: Array<"true" | "false">,
  searchQuery: string,
};

const persistence: Persistence<State> = new Persistence(
  {
    searchQuery: PropTypes.string,
    activationFilter: PropTypes.arrayOf(PropTypes.string),
  },
  "userList",
);

class UserListView extends React.PureComponent<Props, State> {
  state = {
    isLoading: true,
    users: [],
    selectedUserIds: [],
    isExperienceModalVisible: false,
    isTeamRoleModalVisible: false,
    activationFilter: ["true"],
    searchQuery: "",
  };

  componentWillMount() {
    this.setState(persistence.load(this.props.history));
  }

  componentDidMount() {
    this.fetchData();
  }

  componentWillUpdate(nextProps, nextState) {
    persistence.persist(this.props.history, nextState);
  }

  async fetchData(): Promise<void> {
    const users = await getEditableUsers();

    this.setState({
      isLoading: false,
      users,
    });
  }

  activateUser = (selectedUser: APIUserType, isActive: boolean = true): void => {
    const newUsers = this.state.users.map(user => {
      if (selectedUser.id === user.id) {
        const newUser = Object.assign({}, user, { isActive });

        updateUser(newUser);
        return newUser;
      }

      return user;
    });

    this.setState({
      users: newUsers,
      selectedUserIds: [selectedUser.id],
      isTeamRoleModalVisible: isActive,
    });
  };

  deactivateUser = (user: APIUserType): void => {
    this.activateUser(user, false);
  };

  changeEmail = (selectedUser: APIUserType, newEmail: string): void => {
    const newUsers = this.state.users.map(user => {
      if (selectedUser.id === user.id) {
        const newUser = Object.assign({}, user, { email: newEmail });
        updateUser(newUser);
        return newUser;
      }
      return user;
    });

    this.setState({
      users: newUsers,
      selectedUserIds: [selectedUser.id],
    });
    Toast.success(messages["users.change_email_confirmation"]);

    if (this.props.activeUser.email === selectedUser.email) Store.dispatch(logoutUserAction());
  };

  handleUsersChange = (updatedUsers: Array<APIUserType>): void => {
    this.setState({
      users: updatedUsers,
      isExperienceModalVisible: false,
      isTeamRoleModalVisible: false,
    });
  };

  handleSearch = (event: SyntheticInputEvent<>): void => {
    this.setState({ searchQuery: event.target.value });
  };

  handleDismissActivationFilter = () => {
    this.setState({
      activationFilter: [],
    });
  };

  grantAdminRights = async () => {
    if (this.props.activeUser.isAdmin) {
      const newUserPromises = this.state.users.map(user => {
        if (this.state.selectedUserIds.includes(user.id)) {
          const newUser = Object.assign({}, user, { isAdmin: true });

          return updateUser(newUser);
        }

        return Promise.resolve(user);
      });

      this.setState({
        users: await Promise.all(newUserPromises),
      });
    }
  };

  render() {
    const hasRowsSelected = this.state.selectedUserIds.length > 0;
    const rowSelection = {
      onChange: selectedUserIds => {
        this.setState({ selectedUserIds });
      },
      getCheckboxProps: user => ({
        disabled: !user.isActive,
      }),
    };

    const activationFilterWarning = this.state.activationFilter.includes("true") ? (
      <Tag closable onClose={this.handleDismissActivationFilter} color="blue">
        Show Active User Only
      </Tag>
    ) : null;

    const marginRight = { marginRight: 20 };

    return (
      <div className="container test-UserListView">
        <h3>Users</h3>

        {hasRowsSelected ? (
          <span style={marginRight}>{this.state.selectedUserIds.length} selected user(s)</span>
        ) : null}
        <Button
          onClick={() => this.setState({ isTeamRoleModalVisible: true })}
          icon="team"
          disabled={!hasRowsSelected}
          style={marginRight}
        >
          Edit Teams
        </Button>
        <Button
          onClick={() => this.setState({ isExperienceModalVisible: true })}
          icon="trophy"
          disabled={!hasRowsSelected}
          style={marginRight}
        >
          Change Experience
        </Button>
        {this.props.activeUser.isAdmin ? (
          <Button
            onClick={() =>
              Modal.confirm({
                title: messages["users.grant_admin_rights_title"],
                content: messages["users.grant_admin_rights"]({
                  numUsers: this.state.selectedUserIds.length,
                }),
                onOk: this.grantAdminRights,
              })
            }
            icon="rocket"
            disabled={!hasRowsSelected}
            style={marginRight}
          >
            Grant Admin Rights
          </Button>
        ) : null}
        {activationFilterWarning}
        <Search
          style={{ width: 200, float: "right" }}
          onPressEnter={this.handleSearch}
          onChange={this.handleSearch}
          value={this.state.searchQuery}
        />

        <Spin size="large" spinning={this.state.isLoading}>
          <Table
            dataSource={Utils.filterWithSearchQueryOR(
              this.state.users,
              ["firstName", "lastName", "email", "teams", user => Object.keys(user.experiences)],
              this.state.searchQuery,
            )}
            rowKey="id"
            rowSelection={rowSelection}
            pagination={{
              defaultPageSize: 50,
            }}
            style={{ marginTop: 30, marginBotton: 30 }}
            onChange={(pagination, filters) =>
              this.setState({
                activationFilter: filters.isActive,
              })
            }
          >
            <Column
              title="Last Name"
              dataIndex="lastName"
              key="lastName"
              width={130}
              sorter={Utils.localeCompareBy(typeHint, "lastName")}
            />
            <Column
              title="First Name"
              dataIndex="firstName"
              key="firstName"
              width={130}
              sorter={Utils.localeCompareBy(typeHint, "firstName")}
            />
            <Column
              title="Email"
              dataIndex="email"
              key="email"
              sorter={Utils.localeCompareBy(typeHint, "email")}
              render={(__, user: APIUserType) =>
                this.props.activeUser.isAdmin ? (
                  <EditableTextLabel
                    value={user.email}
                    rules={{
                      message: messages["auth.registration_email_invalid"],
                      type: "email",
                    }}
                    onChange={newEmail => {
                      if (newEmail !== user.email) {
                        Modal.confirm({
                          title: messages["users.change_email_title"],
                          content: messages["users.change_email"]({
                            newEmail,
                          }),
                          onOk: () => this.changeEmail(user, newEmail),
                        });
                      }
                    }}
                  />
                ) : (
                  user.email
                )
              }
            />
            <Column
              title="Experiences"
              dataIndex="experiences"
              key="experiences"
              width={300}
              render={(experiences: ExperienceMapType, user: APIUserType) =>
                _.map(experiences, (value, domain) => (
                  <Tag key={`experience_${user.id}_${domain}`}>
                    {domain} : {value}
                  </Tag>
                ))
              }
            />
            <Column
              title="Teams - Role"
              dataIndex="teams"
              key="teams_"
              width={300}
              render={(teams: Array<APITeamMembershipType>, user: APIUserType) => {
                if (user.isAdmin) {
                  return (
                    <Tag key={`team_role_${user.id}`} color="red">
                      Admin - Access to all Teams
                    </Tag>
                  );
                } else {
                  return teams.map(team => {
                    const roleName = team.isTeamManager ? "Team Manager" : "User";
                    return (
                      <Tag
                        key={`team_role_${user.id}_${team.id}`}
                        color={TemplateHelpers.stringToColor(roleName)}
                      >
                        {team.name}: {roleName}
                      </Tag>
                    );
                  });
                }
              }}
            />
            <Column
              title="Status"
              dataIndex="isActive"
              key="isActive"
              width={110}
              filters={[
                { text: "Activated", value: "true" },
                { text: "Deactivated", value: "false" },
              ]}
              filtered
              filteredValue={this.state.activationFilter}
              onFilter={(value: boolean, user: APIUserType) => user.isActive.toString() === value}
              render={isActive => {
                const icon = isActive ? "check-circle-o" : "close-circle-o";
                return <Icon type={icon} style={{ fontSize: 20 }} />;
              }}
            />
            <Column
              title="Actions"
              key="actions"
              width={160}
              render={(__, user: APIUserType) => (
                <span>
                  <Link to={`/users/${user.id}/details`}>
                    <Icon type="user" />Show Tracings
                  </Link>
                  <br />
                  {// eslint-disable-next-line no-nested-ternary
                  this.props.activeUser.isAdmin ? (
                    user.isActive ? (
                      <a href="#" onClick={() => this.deactivateUser(user)}>
                        <Icon type="user-delete" />Deactivate User
                      </a>
                    ) : (
                      <a href="#" onClick={() => this.activateUser(user)}>
                        <Icon type="user-add" />Activate User
                      </a>
                    )
                  ) : null}
                </span>
              )}
            />
          </Table>
        </Spin>
        <ExperienceModalView
          visible={this.state.isExperienceModalVisible}
          selectedUserIds={this.state.selectedUserIds}
          users={this.state.users}
          onChange={this.handleUsersChange}
          onCancel={() => this.setState({ isExperienceModalVisible: false })}
        />
        <TeamRoleModalView
          visible={this.state.isTeamRoleModalVisible}
          selectedUserIds={this.state.selectedUserIds}
          users={this.state.users}
          onChange={this.handleUsersChange}
          onCancel={() => this.setState({ isTeamRoleModalVisible: false })}
        />
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: enforceActiveUser(state.activeUser),
});

export default connect(mapStateToProps)(withRouter(UserListView));
