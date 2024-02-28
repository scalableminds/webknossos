import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  CopyOutlined,
  InfoCircleOutlined,
  MailOutlined,
  TeamOutlined,
  TrophyOutlined,
  UserAddOutlined,
  UserDeleteOutlined,
  UserOutlined,
} from "@ant-design/icons";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module '@sca... Remove this comment to see the full error message
import { PropTypes } from "@scalableminds/prop-types";
import { getEditableUsers, updateUser } from "admin/admin_rest_api";
import { InviteUsersModal } from "admin/onboarding";
import { getActiveUserCount } from "admin/organization/pricing_plan_utils";
import { renderTeamRolesAndPermissionsForUser } from "admin/team/team_list_view";
import ExperienceModalView from "admin/user/experience_modal_view";
import PermissionsAndTeamsModalView from "admin/user/permissions_and_teams_modal_view";
import { Alert, Button, Col, Input, Modal, Row, Spin, Table, Tag, Tooltip } from "antd";
import { Key } from "antd/lib/table/interface";
import LinkButton from "components/link_button";
import dayjs from "dayjs";
import Persistence from "libs/persistence";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import { location } from "libs/window";
import _ from "lodash";
import messages from "messages";
import { enforceActiveOrganization } from "oxalis/model/accessors/organization_accessors";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import type { OxalisState } from "oxalis/store";
import EditableTextLabel from "oxalis/view/components/editable_text_label";
import React from "react";
import { connect } from "react-redux";
import type { RouteComponentProps } from "react-router-dom";
import { Link } from "react-router-dom";
import type {
  APIOrganization,
  APITeamMembership,
  APIUser,
  ExperienceMap,
} from "types/api_flow_types";
import { logoutUserAction } from "../../oxalis/model/actions/user_actions";
import Store from "../../oxalis/store";

const { Column } = Table;
const { Search } = Input;
const typeHint: APIUser[] = [];

type StateProps = {
  activeUser: APIUser;
  activeOrganization: APIOrganization;
};
type Props = RouteComponentProps & StateProps;

type State = {
  isLoading: boolean;
  users: Array<APIUser>;
  selectedUserIds: Key[];
  isExperienceModalOpen: boolean;
  isTeamRoleModalOpen: boolean;
  isInviteModalOpen: boolean;
  singleSelectedUser: APIUser | null | undefined;
  activationFilter: Array<"activated" | "deactivated" | "verified" | "unverified">;
  searchQuery: string;
  domainToEdit: string | null | undefined;
};
const persistence = new Persistence<Pick<State, "searchQuery" | "activationFilter">>(
  {
    searchQuery: PropTypes.string,
    activationFilter: PropTypes.arrayOf(PropTypes.string),
  },
  "userList",
);

class UserListView extends React.PureComponent<Props, State> {
  state: State = {
    isLoading: true,
    users: [],
    selectedUserIds: [],
    isExperienceModalOpen: false,
    isTeamRoleModalOpen: false,
    isInviteModalOpen: false,
    activationFilter: ["activated"],
    searchQuery: "",
    singleSelectedUser: null,
    domainToEdit: null,
  };

  componentDidMount() {
    // @ts-ignore
    this.setState(persistence.load());
    this.fetchData();

    if (location.hash === "#invite") {
      this.setState({
        isInviteModalOpen: true,
      });
    }
  }

  componentDidUpdate() {
    persistence.persist(this.state);
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

  activateUser = async (selectedUser: APIUser, isActive: boolean = true) => {
    const newUser = await updateUser({ ...selectedUser, isActive });
    const newUsers = this.state.users.map((user) => (selectedUser.id === user.id ? newUser : user));

    this.setState({
      users: newUsers,
    });

    if (!isActive) {
      // Don't ask the user for the team permissions
      return;
    }
    Modal.confirm({
      title: "Account was activated.",
      content:
        "If the user was activated for the first time, they will only be able to see datasets that belong to the Default team. Do you want to configure the teams and permissions of the user?",
      okText: "Configure teams and permissions",
      cancelText: "Close",
      icon: <CheckCircleOutlined style={{ color: "green" }} />,
      onOk: () => {
        this.setState({
          selectedUserIds: [selectedUser.id],
          isTeamRoleModalOpen: isActive,
        });
      },
    });
  };

  deactivateUser = (user: APIUser): void => {
    this.activateUser(user, false);
  };

  changeEmail = async (selectedUser: APIUser, newEmail: string) => {
    const newUserPromises = this.state.users.map((user) => {
      if (selectedUser.id === user.id) {
        const newUser = Object.assign({}, user, {
          email: newEmail,
        });
        return updateUser(newUser);
      }

      return Promise.resolve(user);
    });
    Promise.all(newUserPromises).then(
      (newUsers) => {
        this.setState({
          users: newUsers,
          selectedUserIds: [selectedUser.id],
        });
        Toast.success(messages["users.change_email_confirmation"]);
        if (this.props.activeUser.email === selectedUser.email) Store.dispatch(logoutUserAction());
      },
      () => {}, // Do nothing, change did not succeed
    );
  };

  handleUsersChange = (updatedUsers: Array<APIUser>): void => {
    this.setState({
      users: updatedUsers,
      isExperienceModalOpen: false,
      isTeamRoleModalOpen: false,
    });
  };

  closeExperienceModal = (updatedUsers: Array<APIUser>): void => {
    const updatedUsersMap = _.keyBy(updatedUsers, (u) => u.id);

    this.setState((prevState) => ({
      isExperienceModalOpen: false,
      users: prevState.users.map((user) => updatedUsersMap[user.id] || user),
      singleSelectedUser: null,
      selectedUserIds: prevState.singleSelectedUser == null ? [] : prevState.selectedUserIds,
    }));
  };

  handleSearch = (event: React.ChangeEvent<HTMLInputElement>): void => {
    this.setState({
      searchQuery: event.target.value,
    });
  };

  handleDismissActivationFilter = () => {
    this.setState({
      activationFilter: [],
    });
  };

  renderNewUsersAlert() {
    const now = dayjs();
    const newInactiveUsers = this.state.users.filter(
      (user) => !user.isActive && dayjs.duration(now.diff(user.created)).asDays() <= 14,
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
        {newInactiveUsers.map((user) => (
          <Row key={user.id} gutter={16}>
            <Col span={6}>{`${user.lastName}, ${user.firstName} (${user.email}) `}</Col>
            <Col span={4}>
              <LinkButton onClick={() => this.activateUser(user)}>
                <UserAddOutlined />
                Activate User
              </LinkButton>
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
        style={{
          marginTop: 20,
        }}
      />
    ) : null;
  }

  renderInviteUsersAlert() {
    const inviteUsersCallback = () =>
      this.setState({
        isInviteModalOpen: true,
      });

    const noUsersMessage = (
      <React.Fragment>
        <a onClick={inviteUsersCallback}>Invite colleagues and collaboration partners</a>
        {" to join your organization. Share datasets and collaboratively work on annotiatons."}
      </React.Fragment>
    );
    return this.state.isLoading ? null : (
      <Alert
        message="Invite more users"
        description={noUsersMessage}
        type="info"
        showIcon
        style={{
          marginTop: 20,
        }}
        action={
          <Button type="primary" onClick={inviteUsersCallback}>
            Invite Users
          </Button>
        }
      />
    );
  }

  renderUpgradePlanAlert() {
    return (
      <Alert
        message="You reached the maximum number of users"
        description={`You organization reached the maxmium number of users included in your current plan. Consider upgrading your WEBKNOSSOS plan to accommodate more users or deactivate some user accounts. Email invites are disabled in the meantime. Your organization currently has ${getActiveUserCount(
          this.state.users,
        )} active users of ${this.props.activeOrganization.includedUsers} allowed by your plan.`}
        type="error"
        showIcon
        style={{
          marginTop: 20,
        }}
        action={
          <Link to={`/organizations/${this.props.activeUser.organization}`}>
            <Button type="primary">Upgrade Plan</Button>
          </Link>
        }
      />
    );
  }

  getAllSelectedUsers(): Array<APIUser> {
    if (this.state.selectedUserIds.length > 0) {
      return this.state.users.filter((user) => this.state.selectedUserIds.includes(user.id));
    } else return [];
  }

  onSelectUserRow = (userId: string) => {
    this.setState((prevState) => {
      const selectedUserIds = [...prevState.selectedUserIds];
      const indexOfUser = selectedUserIds.indexOf(userId);

      if (indexOfUser >= 0) {
        selectedUserIds.splice(indexOfUser, 1);
      } else {
        selectedUserIds.push(userId);
      }

      return {
        selectedUserIds,
      };
    });
  };

  render() {
    const hasRowsSelected = this.state.selectedUserIds.length > 0;
    const rowSelection = {
      preserveSelectedRowKeys: true,

      onChange: (selectedUserIds: Key[]) => {
        this.setState({
          selectedUserIds,
        });
      },
      getCheckboxProps: (user: APIUser) => ({
        disabled: !user.isActive,
      }),
      selectedRowKeys: this.state.selectedUserIds,
    };
    const activationFilterWarning = this.state.activationFilter.includes("activated") ? (
      <Tag closable onClose={this.handleDismissActivationFilter} color="blue">
        Show Active Users Only
      </Tag>
    ) : null;
    const marginRight = {
      marginRight: 20,
    };
    const noOtherUsers = this.state.users.length < 2;
    const isUserInvitesDisabled =
      getActiveUserCount(this.state.users) >= this.props.activeOrganization.includedUsers;

    return (
      <div className="container test-UserListView">
        <h3>Users</h3>

        <div
          style={{
            marginBottom: 20,
          }}
        >
          {hasRowsSelected ? (
            <span style={marginRight}>{this.state.selectedUserIds.length} selected user(s)</span>
          ) : null}
          <Button
            onClick={() =>
              this.setState({
                isTeamRoleModalOpen: true,
              })
            }
            icon={<TeamOutlined />}
            disabled={!hasRowsSelected}
            style={marginRight}
          >
            Edit Teams &amp; Permissions
          </Button>
          <Button
            onClick={() => {
              this.setState({
                isExperienceModalOpen: true,
              });
            }}
            icon={<TrophyOutlined />}
            disabled={!hasRowsSelected}
            style={marginRight}
          >
            Change Experience
          </Button>
          <Button
            icon={<UserAddOutlined />}
            disabled={isUserInvitesDisabled}
            style={marginRight}
            onClick={() =>
              this.setState({
                isInviteModalOpen: true,
              })
            }
          >
            Invite Users
          </Button>
          <InviteUsersModal
            currentUserCount={getActiveUserCount(this.state.users)}
            maxUserCountPerOrganization={this.props.activeOrganization.includedUsers}
            isOpen={this.state.isInviteModalOpen}
            organizationName={this.props.activeUser.organization}
            handleVisibleChange={(visible) => {
              this.setState({
                isInviteModalOpen: visible,
              });
            }}
          />
        </div>
        <div
          style={{
            marginBottom: 20,
          }}
        >
          {activationFilterWarning}
          <Search
            style={{
              width: 200,
              float: "right",
            }}
            onChange={this.handleSearch}
            value={this.state.searchQuery}
          />
          <div className="clearfix" />
        </div>

        {isUserInvitesDisabled ? this.renderUpgradePlanAlert() : null}
        {noOtherUsers && !isUserInvitesDisabled ? this.renderInviteUsersAlert() : null}
        {this.renderNewUsersAlert()}

        <Spin size="large" spinning={this.state.isLoading}>
          <Table
            dataSource={Utils.filterWithSearchQueryAND(
              this.state.users,
              ["firstName", "lastName", "email", "teams", (user) => Object.keys(user.experiences)],
              this.state.searchQuery,
            )}
            rowKey="id"
            rowSelection={rowSelection}
            pagination={{
              defaultPageSize: 50,
            }}
            style={{
              marginTop: 30,
            }}
            onChange={(_pagination, filters) =>
              this.setState({
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'FilterValue' is not assignable to type '("tr... Remove this comment to see the full error message
                activationFilter: filters.isActive != null ? filters.isActive : [],
              })
            }
            onRow={(user) => ({
              onClick: () => this.onSelectUserRow(user.id),
            })}
            className="large-table"
            scroll={{
              x: "max-content",
            }}
          >
            <Column
              title="Last Name"
              dataIndex="lastName"
              key="lastName"
              width={200}
              sorter={Utils.localeCompareBy(typeHint, (user) => user.lastName)}
            />
            <Column
              title="First Name"
              dataIndex="firstName"
              key="firstName"
              width={200}
              sorter={Utils.localeCompareBy(typeHint, (user) => user.firstName)}
            />
            <Column
              title="Email"
              dataIndex="email"
              key="email"
              width={320}
              sorter={Utils.localeCompareBy(typeHint, (user) => user.email)}
              render={(__, user: APIUser) =>
                this.props.activeUser.isAdmin ? (
                  <EditableTextLabel
                    value={user.email}
                    label="Email"
                    rules={[
                      {
                        message: messages["auth.registration_email_invalid"],
                        type: "email",
                      },
                    ]}
                    onChange={(newEmail) => {
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
                      onClick={(evt) => {
                        evt.stopPropagation();
                        this.setState((prevState) => ({
                          // If no user is selected, set singleSelectedUser. Otherwise,
                          // open the modal so that all selected users are edited.
                          singleSelectedUser: prevState.selectedUserIds.length > 0 ? null : user,
                          isExperienceModalOpen: true,
                          domainToEdit: domain,
                        }));
                      }}
                    >
                      {domain} : {value}
                    </span>
                    <CopyOutlined
                      style={{
                        margin: "0 0 0 5px",
                      }}
                      onClick={async (evt) => {
                        evt.stopPropagation();
                        await navigator.clipboard.writeText(domain);
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
              render={(_teams: APITeamMembership[], user: APIUser) =>
                renderTeamRolesAndPermissionsForUser(user)
              }
            />
            <Column
              title="Status"
              dataIndex="isActive"
              key="isActive"
              width={110}
              filters={[
                {
                  text: "Activated",
                  value: "activated",
                },
                {
                  text: "Deactivated",
                  value: "deactivated",
                },
                {
                  text: "E-Mail is verified",
                  value: "verified",
                },
                {
                  text: "E-Mail is not verified",
                  value: "unverified",
                },
              ]}
              filtered
              filteredValue={this.state.activationFilter}
              filterMultiple
              // @ts-ignore
              onFilter={(
                value: "activated" | "deactivated" | "verified" | "unverified",
                user: APIUser,
              ) => {
                if (value === "activated") {
                  return user.isActive;
                } else if (value === "deactivated") {
                  return !user.isActive;
                } else if (value === "verified") {
                  return user.isEmailVerified;
                } else if (value === "unverified") {
                  return !user.isEmailVerified;
                }
              }}
              render={(isActive, user: APIUser) => {
                const activation = isActive ? (
                  <Tooltip title="Account is activated">
                    <CheckCircleOutlined
                      className="icon-margin-right"
                      style={{
                        fontSize: 20,
                      }}
                    />
                  </Tooltip>
                ) : (
                  <Tooltip title="Account is not activated">
                    <CloseCircleOutlined
                      className="icon-margin-right"
                      style={{
                        fontSize: 20,
                        color: "#e84749",
                      }}
                    />
                  </Tooltip>
                );

                const mail = user.isEmailVerified ? (
                  <Tooltip title="Email is verified">
                    <MailOutlined
                      className="icon-margin-right"
                      style={{
                        fontSize: 20,
                      }}
                    />
                  </Tooltip>
                ) : (
                  <Tooltip title="Email is not verified">
                    <MailOutlined
                      className="icon-margin-right"
                      style={{
                        fontSize: 20,
                        color: "#e84749",
                      }}
                    />
                  </Tooltip>
                );

                return (
                  <>
                    {activation}
                    {mail}
                  </>
                );
              }}
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
                  {
                    // eslint-disable-next-line no-nested-ternary
                    user.isActive ? (
                      this.props.activeUser.isAdmin ? (
                        <LinkButton
                          onClick={(event) => {
                            event.stopPropagation();
                            this.deactivateUser(user);
                          }}
                        >
                          <UserDeleteOutlined />
                          Deactivate User
                        </LinkButton>
                      ) : null
                    ) : (
                      <LinkButton
                        onClick={(event) => {
                          event.stopPropagation();
                          this.activateUser(user);
                        }}
                      >
                        <UserAddOutlined />
                        Activate User
                      </LinkButton>
                    )
                  }
                </span>
              )}
            />
          </Table>
        </Spin>
        {this.state.isExperienceModalOpen ? (
          <ExperienceModalView
            isOpen={this.state.isExperienceModalOpen}
            selectedUsers={
              this.state.singleSelectedUser
                ? [this.state.singleSelectedUser]
                : this.getAllSelectedUsers()
            }
            initialDomainToEdit={this.state.domainToEdit}
            onChange={this.closeExperienceModal}
            onCancel={() =>
              this.setState({
                isExperienceModalOpen: false,
                singleSelectedUser: null,
                domainToEdit: null,
              })
            }
          />
        ) : null}
        <PermissionsAndTeamsModalView
          isOpen={this.state.isTeamRoleModalOpen}
          selectedUserIds={this.state.selectedUserIds}
          users={this.state.users}
          onChange={this.handleUsersChange}
          onCancel={() =>
            this.setState({
              isTeamRoleModalOpen: false,
            })
          }
          activeUser={this.props.activeUser}
        />
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: enforceActiveUser(state.activeUser),
  activeOrganization: enforceActiveOrganization(state.activeOrganization),
});

const connector = connect(mapStateToProps);
export default connector(UserListView);
