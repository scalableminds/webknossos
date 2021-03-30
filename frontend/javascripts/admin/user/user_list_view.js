// @flow
import { Link, type RouterHistory, withRouter } from "react-router-dom";
import { PropTypes } from "@scalableminds/prop-types";
import { Table, Tag, Spin, Button, Input, Modal, Alert, Row, Col, Tooltip } from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  CopyOutlined,
  InfoCircleOutlined,
  TeamOutlined,
  TrophyOutlined,
  UserAddOutlined,
  UserDeleteOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { connect } from "react-redux";
import Clipboard from "clipboard-js";
import * as React from "react";
import _ from "lodash";
import moment from "moment";

import type { APIUser, APITeamMembership, ExperienceMap } from "types/api_flow_types";
import { InviteUsersModal } from "admin/onboarding";
import type { OxalisState } from "oxalis/store";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import { getEditableUsers, updateUser } from "admin/admin_rest_api";
import { stringToColor } from "libs/format_utils";
import EditableTextLabel from "oxalis/view/components/editable_text_label";
import ExperienceModalView from "admin/user/experience_modal_view";
import Persistence from "libs/persistence";
import PermissionsAndTeamsModalView from "admin/user/permissions_and_teams_modal_view";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import messages from "messages";

import { logoutUserAction } from "../../oxalis/model/actions/user_actions";
import Store from "../../oxalis/store";

const { Column } = Table;
const { Search } = Input;

const typeHint: APIUser[] = [];

type StateProps = {|
  activeUser: APIUser,
|};
type Props = StateProps;
type PropsWithRouter = {| ...Props, history: RouterHistory |};

type State = {
  isLoading: boolean,
  users: Array<APIUser>,
  selectedUserIds: Array<string>,
  isExperienceModalVisible: boolean,
  isTeamRoleModalVisible: boolean,
  isInviteModalVisible: boolean,
  singleSelectedUser: ?APIUser,
  activationFilter: Array<"true" | "false">,
  searchQuery: string,
  domainToEdit: ?string,
};

const persistence: Persistence<State> = new Persistence(
  {
    searchQuery: PropTypes.string,
    activationFilter: PropTypes.arrayOf(PropTypes.string),
  },
  "userList",
);

class UserListView extends React.PureComponent<PropsWithRouter, State> {
  state = {
    isLoading: true,
    users: [],
    selectedUserIds: [],
    isExperienceModalVisible: false,
    isTeamRoleModalVisible: false,
    isInviteModalVisible: false,
    activationFilter: ["true"],
    searchQuery: "",
    singleSelectedUser: null,
    domainToEdit: null,
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
    this.setState({
      isLoading: true,
    });
    const users = await getEditableUsers();

    this.setState({
      isLoading: false,
      users,
    });
  }

  activateUser = (selectedUser: APIUser, isActive: boolean = true): void => {
    this.setState(prevState => {
      const newUsers = prevState.users.map(user => {
        if (selectedUser.id === user.id) {
          const newUser = Object.assign({}, user, { isActive });
          updateUser(newUser);
          return newUser;
        }
        return user;
      });

      return {
        users: newUsers,
        selectedUserIds: [selectedUser.id],
        isTeamRoleModalVisible: isActive,
      };
    });
  };

  deactivateUser = (user: APIUser): void => {
    this.activateUser(user, false);
  };

  changeEmail = (selectedUser: APIUser, newEmail: string): void => {
    this.setState(prevState => {
      const newUsers = prevState.users.map(user => {
        if (selectedUser.id === user.id) {
          const newUser = Object.assign({}, user, { email: newEmail });
          updateUser(newUser);
          return newUser;
        }
        return user;
      });

      return {
        users: newUsers,
        selectedUserIds: [selectedUser.id],
      };
    });
    Toast.success(messages["users.change_email_confirmation"]);

    if (this.props.activeUser.email === selectedUser.email) Store.dispatch(logoutUserAction());
  };

  handleUsersChange = (updatedUsers: Array<APIUser>): void => {
    this.setState({
      users: updatedUsers,
      isExperienceModalVisible: false,
      isTeamRoleModalVisible: false,
    });
  };

  closeExperienceModal = (updatedUsers: Array<APIUser>): void => {
    const updatedUsersMap = _.keyBy(updatedUsers, u => u.id);
    this.setState(prevState => ({
      isExperienceModalVisible: false,
      users: prevState.users.map(user => updatedUsersMap[user.id] || user),
      singleSelectedUser: null,
      selectedUserIds: prevState.singleSelectedUser == null ? [] : prevState.selectedUserIds,
    }));
  };

  handleSearch = (event: SyntheticInputEvent<>): void => {
    this.setState({ searchQuery: event.target.value });
  };

  handleDismissActivationFilter = () => {
    this.setState({
      activationFilter: [],
    });
  };

  renderNewUsersAlert() {
    const now = moment();
    const newInactiveUsers = this.state.users.filter(
      user => !user.isActive && moment.duration(now.diff(user.created)).asDays() <= 14,
    );

    const newInactiveUsersHeader = (
      <React.Fragment>
        There are new inactive users{" "}
        <Tooltip
          title="The displayed users are inactive and were created in the past 14 days."
          placement="right"
        >
          <InfoCircleOutlined />
        </Tooltip>
      </React.Fragment>
    );
    const newInactiveUsersList = (
      <React.Fragment>
        {newInactiveUsers.map(user => (
          <Row key={user.id} gutter={16}>
            <Col span={6}>{`${user.lastName}, ${user.firstName} (${user.email}) `}</Col>
            <Col span={4}>
              <a href="#" onClick={() => this.activateUser(user)}>
                <UserAddOutlined />
                Activate User
              </a>
            </Col>
          </Row>
        ))}
      </React.Fragment>
    );

    return newInactiveUsers.length ? (
      <Alert
        message={newInactiveUsersHeader}
        description={newInactiveUsersList}
        type="info"
        icon={<UserOutlined />}
        showIcon
        style={{ marginTop: 20 }}
      />
    ) : null;
  }

  renderPlaceholder() {
    const noUsersMessage = (
      <React.Fragment>
        {"You can "}
        <a onClick={() => this.setState({ isInviteModalVisible: true })}>invite more users</a>
        {" to join your organization. After the users joined, you need to activate them manually."}
      </React.Fragment>
    );

    return this.state.isLoading ? null : (
      <Alert
        message="Invite more users"
        description={noUsersMessage}
        type="info"
        showIcon
        style={{ marginTop: 20 }}
      />
    );
  }

  getAllSelectedUsers(): Array<APIUser> {
    if (this.state.selectedUserIds.length > 0) {
      return this.state.users.filter(user => this.state.selectedUserIds.includes(user.id));
    } else return [];
  }

  onSelectUserRow = userId => {
    this.setState(prevState => {
      const selectedUserIds = [...prevState.selectedUserIds];
      const indexOfUser = selectedUserIds.indexOf(userId);
      if (indexOfUser >= 0) {
        selectedUserIds.splice(indexOfUser, 1);
      } else {
        selectedUserIds.push(userId);
      }
      this.setState({ selectedUserIds });
    });
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
      selectedRowKeys: this.state.selectedUserIds,
    };

    const activationFilterWarning = this.state.activationFilter.includes("true") ? (
      <Tag closable onClose={this.handleDismissActivationFilter} color="blue">
        Show Active Users Only
      </Tag>
    ) : null;

    const marginRight = { marginRight: 20 };
    const noOtherUsers = this.state.users.length < 2;

    return (
      <div className="container test-UserListView">
        <h3>Users</h3>

        <div style={{ marginBottom: 20 }}>
          {hasRowsSelected ? (
            <span style={marginRight}>{this.state.selectedUserIds.length} selected user(s)</span>
          ) : null}
          <Button
            onClick={() => this.setState({ isTeamRoleModalVisible: true })}
            icon={<TeamOutlined />}
            disabled={!hasRowsSelected}
            style={marginRight}
          >
            Edit Teams &amp; Permissions
          </Button>
          <Button
            onClick={() => {
              this.setState({ isExperienceModalVisible: true });
            }}
            icon={<TrophyOutlined />}
            disabled={!hasRowsSelected}
            style={marginRight}
          >
            Change Experience
          </Button>
          <Button
            icon={<UserAddOutlined />}
            style={marginRight}
            onClick={() => this.setState({ isInviteModalVisible: true })}
          >
            Invite Users
          </Button>
          <InviteUsersModal
            organizationName={this.props.activeUser.organization}
            visible={this.state.isInviteModalVisible}
            handleVisibleChange={visible => {
              this.setState({ isInviteModalVisible: visible });
            }}
          />
        </div>
        <div style={{ marginBottom: 20 }}>
          {activationFilterWarning}
          <Search
            style={{ width: 200, float: "right" }}
            onPressEnter={this.handleSearch}
            onChange={this.handleSearch}
            value={this.state.searchQuery}
          />
          <div className="clearfix" />
        </div>

        {noOtherUsers ? this.renderPlaceholder() : null}
        {this.renderNewUsersAlert()}

        <Spin size="large" spinning={this.state.isLoading}>
          <Table
            dataSource={Utils.filterWithSearchQueryAND(
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
            onRow={user => ({ onClick: () => this.onSelectUserRow(user.id) })}
            className="large-table"
            scroll={{ x: "max-content" }}
          >
            <Column
              title="Last Name"
              dataIndex="lastName"
              key="lastName"
              width={200}
              sorter={Utils.localeCompareBy(typeHint, user => user.lastName)}
            />
            <Column
              title="First Name"
              dataIndex="firstName"
              key="firstName"
              width={200}
              sorter={Utils.localeCompareBy(typeHint, user => user.firstName)}
            />
            <Column
              title="Email"
              dataIndex="email"
              key="email"
              width={350}
              sorter={Utils.localeCompareBy(typeHint, user => user.email)}
              render={(__, user: APIUser) =>
                this.props.activeUser.isAdmin ? (
                  <EditableTextLabel
                    value={user.email}
                    label="Email"
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
              width={250}
              render={(experiences: ExperienceMap, user: APIUser) =>
                _.map(experiences, (value, domain) => (
                  <Tag key={`experience_${user.id}_${domain}`}>
                    <span
                      onClick={evt => {
                        evt.stopPropagation();
                        this.setState(prevState => ({
                          // If no user is selected, set singleSelectedUser. Otherwise,
                          // open the modal so that all selected users are edited.
                          singleSelectedUser: prevState.selectedUserIds.length > 0 ? null : user,
                          isExperienceModalVisible: true,
                          domainToEdit: domain,
                        }));
                      }}
                    >
                      {domain} : {value}
                    </span>
                    <CopyOutlined
                      style={{ margin: "0 0 0 5px" }}
                      onClick={async () => {
                        await Clipboard.copy(domain);
                        Toast.success(`"${domain}" copied to clipboard`);
                      }}
                    />
                  </Tag>
                ))
              }
            />
            <Column
              title="Teams - Role"
              dataIndex="teams"
              key="teams_"
              width={250}
              render={(teams: Array<APITeamMembership>, user: APIUser) => {
                if (user.isAdmin) {
                  return (
                    <Tag key={`team_role_${user.id}`} color="red">
                      Admin - Access to all Teams
                    </Tag>
                  );
                } else {
                  const teamTags = user.isDatasetManager
                    ? [
                        <Tag key={`dataset_manager_${user.id}`} color="geekblue">
                          Dataset Manager - Edit all Datasets
                        </Tag>,
                      ]
                    : [];
                  return teamTags.concat(
                    teams.map(team => {
                      const roleName = team.isTeamManager ? "Team Manager" : "Member";
                      return (
                        <Tag
                          key={`team_role_${user.id}_${team.id}`}
                          color={stringToColor(roleName)}
                        >
                          {team.name}: {roleName}
                        </Tag>
                      );
                    }),
                  );
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
              onFilter={(value: boolean, user: APIUser) => user.isActive.toString() === value}
              render={isActive =>
                isActive ? (
                  <CheckCircleOutlined style={{ fontSize: 20 }} />
                ) : (
                  <CloseCircleOutlined style={{ fontSize: 20 }} />
                )
              }
            />
            <Column
              title="Actions"
              key="actions"
              width={175}
              fixed="right"
              render={(__, user: APIUser) => (
                <span>
                  <Link to={`/users/${user.id}/details`}>
                    <UserOutlined />
                    Show Annotations
                  </Link>
                  <br />
                  {// eslint-disable-next-line no-nested-ternary
                  user.isActive ? (
                    this.props.activeUser.isAdmin ? (
                      <a href="#" onClick={() => this.deactivateUser(user)}>
                        <UserDeleteOutlined />
                        Deactivate User
                      </a>
                    ) : null
                  ) : (
                    <a href="#" onClick={() => this.activateUser(user)}>
                      <UserAddOutlined />
                      Activate User
                    </a>
                  )}
                </span>
              )}
            />
          </Table>
        </Spin>
        {this.state.isExperienceModalVisible ? (
          <ExperienceModalView
            visible={this.state.isExperienceModalVisible}
            selectedUsers={
              this.state.singleSelectedUser
                ? [this.state.singleSelectedUser]
                : this.getAllSelectedUsers()
            }
            initialDomainToEdit={this.state.domainToEdit}
            onChange={this.closeExperienceModal}
            onCancel={() =>
              this.setState({
                isExperienceModalVisible: false,
                singleSelectedUser: null,
                domainToEdit: null,
              })
            }
          />
        ) : null}
        <PermissionsAndTeamsModalView
          visible={this.state.isTeamRoleModalVisible}
          selectedUserIds={this.state.selectedUserIds}
          users={this.state.users}
          onChange={this.handleUsersChange}
          onCancel={() => this.setState({ isTeamRoleModalVisible: false })}
          activeUser={this.props.activeUser}
        />
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: enforceActiveUser(state.activeUser),
});

export default connect<Props, {||}, _, _, _, _>(mapStateToProps)(withRouter(UserListView));
