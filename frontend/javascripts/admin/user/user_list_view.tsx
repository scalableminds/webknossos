import type { RouteComponentProps } from "react-router-dom";
import { Link } from "react-router-dom";
import { PropTypes } from "@scalableminds/prop-types";
import { Table, Tag, Spin, Button, Input, Modal, Alert, Row, Col, Tooltip, App } from "antd";
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
import { connect } from "react-redux";
import React, { Key, useEffect, useState } from "react";
import _ from "lodash";
import dayjs from "dayjs";
import { location } from "libs/window";
import type {
  APIUser,
  APITeamMembership,
  ExperienceMap,
  APIOrganization,
} from "types/api_flow_types";
import { InviteUsersModal } from "admin/onboarding";
import type { OxalisState } from "oxalis/store";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import LinkButton from "components/link_button";
import { getEditableUsers, updateUser } from "admin/admin_rest_api";
import EditableTextLabel from "oxalis/view/components/editable_text_label";
import ExperienceModalView from "admin/user/experience_modal_view";
import Persistence from "libs/persistence";
import PermissionsAndTeamsModalView from "admin/user/permissions_and_teams_modal_view";
import { getActiveUserCount } from "admin/organization/pricing_plan_utils";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import messages from "messages";
import { logoutUserAction } from "../../oxalis/model/actions/user_actions";
import Store from "../../oxalis/store";
import { enforceActiveOrganization } from "oxalis/model/accessors/organization_accessors";
import { renderTeamRolesAndPermissionsForUser } from "admin/team/team_list_view";

const { Column } = Table;
const { Search } = Input;

type StateProps = {
  activeUser: APIUser;
  activeOrganization: APIOrganization;
};
type Props = RouteComponentProps & StateProps;

type ActivationFilterType = Array<"activated" | "deactivated" | "verified" | "unverified">;

const persistence = new Persistence<{
  activationFilter: ActivationFilterType;
  searchQuery: string;
}>(
  {
    searchQuery: PropTypes.string,
    activationFilter: PropTypes.arrayOf(PropTypes.string),
  },
  "userList",
);

function UserListView({ activeUser, activeOrganization }: Props) {
  const { modal } = App.useApp();

  const [isLoading, setIsLoading] = useState(true);
  const [users, setUsers] = useState<APIUser[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<Key[]>([]);
  const [isExperienceModalOpen, setIsExperienceModalOpen] = useState(false);
  const [isTeamRoleModalOpen, setIsTeamRoleModalOpen] = useState(false);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [activationFilter, setActivationFilter] = useState<ActivationFilterType>(["activated"]);
  const [searchQuery, setSearchQuery] = useState("");
  const [singleSelectedUser, setSingleSelectedUser] = useState<APIUser | null | undefined>(null);
  const [domainToEdit, setDomainToEdit] = useState<string | null | undefined>(null);

  useEffect(() => {
    const { searchQuery, activationFilter } = persistence.load();
    setSearchQuery(searchQuery || "");
    setActivationFilter(activationFilter || ["activated"]);
    fetchData();

    if (location.hash === "#invite") {
      setIsInviteModalOpen(true);
    }
  }, []);

  useEffect(() => {
    persistence.persist({ searchQuery, activationFilter });
  }, [searchQuery, activationFilter]);

  async function fetchData(): Promise<void> {
    setIsLoading(true);
    setUsers(await getEditableUsers());
    setIsLoading(false);
  }

  async function activateUser(selectedUser: APIUser, isActive: boolean = true) {
    const newUser = await updateUser({ ...selectedUser, isActive });
    const newUsers = users.map((user) => (selectedUser.id === user.id ? newUser : user));
    setUsers(newUsers);

    if (!isActive) {
      // Don't ask the user for the team permissions
      return;
    }
    modal.confirm({
      title: "Account was activated.",
      content:
        "If the user was activated for the first time, they will only be able to see datasets that belong to the Default team. Do you want to configure the teams and permissions of the user?",
      okText: "Configure teams and permissions",
      cancelText: "Close",
      icon: <CheckCircleOutlined style={{ color: "green" }} />,
      onOk: () => {
        setSelectedUserIds([selectedUser.id]);
        setIsTeamRoleModalOpen(isActive);
      },
    });
  }

  function deactivateUser(user: APIUser): void {
    activateUser(user, false);
  }

  async function changeEmail(selectedUser: APIUser, newEmail: string) {
    const newUserPromises = users.map((user) => {
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
        setUsers(newUsers);
        setSelectedUserIds([selectedUser.id]);
        Toast.success(messages["users.change_email_confirmation"]);
        if (activeUser.email === selectedUser.email) Store.dispatch(logoutUserAction());
      },
      () => {}, // Do nothing, change did not succeed
    );
  }

  function handleUsersChange(updatedUsers: Array<APIUser>): void {
    setUsers(updatedUsers);
    setIsExperienceModalOpen(false);
    setIsTeamRoleModalOpen(false);
  }

  function closeExperienceModal(updatedUsers: Array<APIUser>): void {
    const updatedUsersMap = _.keyBy(updatedUsers, (u) => u.id);

    setIsExperienceModalOpen(false);
    setUsers((users) => users.map((user) => updatedUsersMap[user.id] || user));
    setSingleSelectedUser(null);
    setSelectedUserIds((singleSelectedUser) => (singleSelectedUser == null ? [] : selectedUserIds));
  }

  function handleSearch(event: React.ChangeEvent<HTMLInputElement>): void {
    setSearchQuery(event.target.value);
  }

  function handleDismissActivationFilter(): void {
    setActivationFilter([]);
  }

  function renderNewUsersAlert() {
    const now = dayjs();
    const newInactiveUsers = users.filter(
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
              <LinkButton onClick={() => activateUser(user)}>
                <UserAddOutlined className="icon-margin-right" />
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
        icon={<UserOutlined className="icon-margin-right" />}
        showIcon
        style={{
          marginTop: 20,
        }}
      />
    ) : null;
  }

  function renderInviteUsersAlert() {
    const inviteUsersCallback = () => setIsInviteModalOpen(true);

    const noUsersMessage = (
      <React.Fragment>
        <a onClick={inviteUsersCallback}>Invite colleagues and collaboration partners</a>
        {" to join your organization. Share datasets and collaboratively work on annotiatons."}
      </React.Fragment>
    );
    return isLoading ? null : (
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

  function renderUpgradePlanAlert() {
    return (
      <Alert
        message="You reached the maximum number of users"
        description={`You organization reached the maxmium number of users included in your current plan. Consider upgrading your WEBKNOSSOS plan to accommodate more users or deactivate some user accounts. Email invites are disabled in the meantime. Your organization currently has ${getActiveUserCount(
          users,
        )} active users of ${activeOrganization.includedUsers} allowed by your plan.`}
        type="warning"
        showIcon
        style={{
          marginTop: 20,
        }}
        action={
          <Link to={`/organizations/${activeUser.organization}`}>
            <Button type="primary">Upgrade Plan</Button>
          </Link>
        }
      />
    );
  }

  function getAllSelectedUsers(): APIUser[] {
    if (selectedUserIds.length > 0) {
      return users.filter((user) => selectedUserIds.includes(user.id));
    }
    return [];
  }

  function onSelectUserRow(userId: string) {
    setSelectedUserIds((selectedUserIds) => {
      const indexOfUser = selectedUserIds.indexOf(userId);
      if (indexOfUser >= 0) {
        return selectedUserIds.splice(indexOfUser, 1);
      } else {
        return [...selectedUserIds, userId];
      }
    });
  }

  const hasRowsSelected = selectedUserIds.length > 0;
  const rowSelection = {
    preserveSelectedRowKeys: true,

    onChange: (selectedUserIds: Key[]) => {
      setSelectedUserIds(selectedUserIds);
    },
    getCheckboxProps: (user: APIUser) => ({
      disabled: !user.isActive,
    }),
    selectedRowKeys: selectedUserIds,
  };
  const activationFilterWarning = activationFilter.includes("activated") ? (
    <Tag closable onClose={handleDismissActivationFilter} color="blue">
      Show Active Users Only
    </Tag>
  ) : null;
  const marginRight = {
    marginRight: 20,
  };
  const noOtherUsers = users.length < 2;
  const isUserInvitesDisabled = getActiveUserCount(users) >= activeOrganization.includedUsers;

  return (
    <div className="container test-UserListView">
      <h3>Users</h3>

      <div
        style={{
          marginBottom: 20,
        }}
      >
        {hasRowsSelected ? (
          <span style={marginRight}>{selectedUserIds.length} selected user(s)</span>
        ) : null}
        <Button
          onClick={() => setIsTeamRoleModalOpen(true)}
          icon={<TeamOutlined />}
          disabled={!hasRowsSelected}
          style={marginRight}
        >
          Edit Teams &amp; Permissions
        </Button>
        <Button
          onClick={() => {
            setIsExperienceModalOpen(true);
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
          onClick={() => setIsInviteModalOpen(true)}
        >
          Invite Users
        </Button>
        <InviteUsersModal
          currentUserCount={getActiveUserCount(users)}
          maxUserCountPerOrganization={activeOrganization.includedUsers}
          isOpen={isInviteModalOpen}
          organizationName={activeUser.organization}
          handleVisibleChange={(visible) => {
            setIsInviteModalOpen(visible);
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
          onChange={handleSearch}
          value={searchQuery}
        />
        <div className="clearfix" />
      </div>

      {isUserInvitesDisabled ? renderUpgradePlanAlert() : null}
      {noOtherUsers && !isUserInvitesDisabled ? renderInviteUsersAlert() : null}
      {renderNewUsersAlert()}

      <Spin size="large" spinning={isLoading}>
        <Table
          dataSource={Utils.filterWithSearchQueryAND(
            users,
            ["firstName", "lastName", "email", "teams", (user) => Object.keys(user.experiences)],
            searchQuery,
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
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'FilterValue' is not assignable to type '("tr... Remove this comment to see the full erro(messag)
            setActivationFilter(filters.isActive != null ? filters.isActive : [])
          }
          onRow={(user) => ({
            onClick: () => onSelectUserRow(user.id),
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
            sorter={Utils.localeCompareBy<APIUser>((user) => user.lastName)}
          />
          <Column
            title="First Name"
            dataIndex="firstName"
            key="firstName"
            width={200}
            sorter={Utils.localeCompareBy<APIUser>((user) => user.firstName)}
          />
          <Column
            title="Email"
            dataIndex="email"
            key="email"
            width={320}
            sorter={Utils.localeCompareBy<APIUser>((user) => user.email)}
            render={(__, user: APIUser) =>
              activeUser.isAdmin ? (
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
                        onOk: () => changeEmail(user, newEmail),
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
                      // If no user is selected, set singleSelectedUser. Otherwise,
                      // open the modal so that all selected users are edited.
                      setSingleSelectedUser(selectedUserIds.length > 0 ? null : user);
                      setDomainToEdit(domain);
                      setIsExperienceModalOpen(true);
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
            filteredValue={activationFilter}
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
                  <UserOutlined className="icon-margin-right" />
                  Show Annotations
                </Link>
                <br />
                {user.isActive ? (
                  activeUser.isAdmin ? (
                    <LinkButton
                      onClick={(event) => {
                        event.stopPropagation();
                        deactivateUser(user);
                      }}
                    >
                      <UserDeleteOutlined className="icon-margin-right" />
                      Deactivate User
                    </LinkButton>
                  ) : null
                ) : (
                  <LinkButton
                    onClick={(event) => {
                      event.stopPropagation();
                      activateUser(user);
                    }}
                  >
                    <UserAddOutlined className="icon-margin-right" />
                    Activate User
                  </LinkButton>
                )}
              </span>
            )}
          />
        </Table>
      </Spin>
      {isExperienceModalOpen ? (
        <ExperienceModalView
          isOpen={isExperienceModalOpen}
          selectedUsers={singleSelectedUser ? [singleSelectedUser] : getAllSelectedUsers()}
          initialDomainToEdit={domainToEdit}
          onChange={closeExperienceModal}
          onCancel={() => {
            setIsExperienceModalOpen(false);
            setSingleSelectedUser(null);
            setDomainToEdit(null);
          }}
        />
      ) : null}
      <PermissionsAndTeamsModalView
        isOpen={isTeamRoleModalOpen}
        selectedUserIds={selectedUserIds}
        users={users}
        onChange={handleUsersChange}
        onCancel={() => setIsTeamRoleModalOpen(false)}
        activeUser={activeUser}
      />
    </div>
  );
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: enforceActiveUser(state.activeUser),
  activeOrganization: enforceActiveOrganization(state.activeOrganization),
});

const connector = connect(mapStateToProps);
export default connector(UserListView);
