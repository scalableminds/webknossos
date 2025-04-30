import { InfoCircleOutlined } from "@ant-design/icons";
import { getEditableTeams, updateUser } from "admin/admin_rest_api";
import { App, Checkbox, Col, Divider, Modal, Radio, type RadioChangeEvent, Row } from "antd";
import { useFetch } from "libs/react_helpers";
import * as Utils from "libs/utils";
import _ from "lodash";
import messages from "messages";
import React, { type Key, useEffect, useState } from "react";
import type { APITeam, APITeamMembership, APIUser } from "types/api_types";
const RadioButton = Radio.Button;
const RadioGroup = Radio.Group;

enum ROLES {
  teammanager = "teammanager",
  user = "user",
}
enum PERMISSIONS {
  admin = "admin",
  datasetManager = "datasetManager",
  member = "member",
}

type TeamRoleModalProps = {
  onChange: (...args: Array<any>) => any;
  onCancel: (...args: Array<any>) => any;
  isOpen: boolean;
  selectedUserIds: Key[];
  users: Array<APIUser>;
  activeUser: APIUser;
};

function getPermissionGroupOfUser(user: APIUser) {
  if (user.isAdmin) {
    return PERMISSIONS.admin;
  }

  if (user.isDatasetManager) {
    return PERMISSIONS.datasetManager;
  }

  return PERMISSIONS.member;
}

function PermissionsAndTeamsModalView({
  onChange,
  onCancel,
  isOpen,
  selectedUserIds,
  users,
  activeUser,
}: TeamRoleModalProps) {
  const { modal } = App.useApp();

  const [selectedTeams, setSelectedTeams] = useState<Record<string, APITeamMembership>>({});
  const [selectedPermission, setSelectedPermission] = useState(PERMISSIONS.member);

  const teams = useFetch(getEditableTeams, [], []);

  useEffect(() => {
    // If a single user is selected, pre-select his teams
    const singleUserMaybe = getSingleUserMaybe(selectedUserIds, users);

    if (singleUserMaybe) {
      const newSelectedTeams = _.keyBy(singleUserMaybe.teams, "name");

      const userPermission = getPermissionGroupOfUser(singleUserMaybe);
      setSelectedTeams(newSelectedTeams);
      setSelectedPermission(userPermission);
    }
  }, [selectedUserIds, users]);

  function didPermissionsChange() {
    const singleUserMaybe = getSingleUserMaybe(selectedUserIds, users);

    if (!singleUserMaybe) {
      return false;
    }

    let previousPermission = PERMISSIONS.member;

    if (singleUserMaybe.isAdmin) {
      previousPermission = PERMISSIONS.admin;
    } else if (singleUserMaybe.isDatasetManager) {
      previousPermission = PERMISSIONS.datasetManager;
    }

    return previousPermission !== selectedPermission;
  }

  function handleUpdatePermissionsAndTeams() {
    if (didPermissionsChange()) {
      const user = getSingleUserMaybe(selectedUserIds, users);

      if (user) {
        const userName = `${user.firstName} ${user.lastName}`;
        let message = messages["users.revoke_all_permissions"];

        if (selectedPermission === PERMISSIONS.admin) {
          message = messages["users.set_admin"];
        }

        if (selectedPermission === PERMISSIONS.datasetManager) {
          message = messages["users.set_dataset_manager"];
        }

        modal.confirm({
          title: messages["users.change_permissions_title"],
          content: message({
            userName,
          }),
          onOk: setPermissionsAndTeams,
        });
      }
    } else {
      setPermissionsAndTeams();
    }
  }

  function setPermissionsAndTeams() {
    const newUserPromises = users.map((user) => {
      if (selectedUserIds.includes(user.id)) {
        const newTeams = Utils.values(selectedTeams);
        let permissions = { isAdmin: false, isDatasetManager: false };

        if (activeUser.isAdmin && selectedUserIds.length === 1) {
          // If the current user is admin and only one user is edited we also update the permissions.
          if (selectedPermission === PERMISSIONS.admin) {
            permissions["isAdmin"] = true;
            permissions["isDatasetManager"] = false;
          } else if (selectedPermission === PERMISSIONS.datasetManager) {
            permissions["isDatasetManager"] = true;
            permissions["isAdmin"] = false;
          }
        }
        const newUser = { ...user, ...permissions, teams: newTeams };

        // server-side validation can reject a user's new teams
        return updateUser(newUser).then(
          (serverUser) => Promise.resolve(serverUser),
          () => Promise.reject(user),
        );
      }

      return Promise.resolve(user);
    });
    Promise.all(newUserPromises).then(
      (newUsers) => {
        onChange(newUsers);
      },
      () => {
        // do nothing and keep modal open
      },
    );
  }

  function handlePermissionChanged(evt: RadioChangeEvent) {
    const selectedPermission: PERMISSIONS = evt.target.value;
    setSelectedPermission(selectedPermission);
  }

  function handleSelectTeamRole(teamName: string, isTeamManager: boolean) {
    const team = teams.find((t) => t.name === teamName);

    if (team) {
      const selectedTeam = {
        id: team.id,
        name: teamName,
        isTeamManager,
      };

      setSelectedTeams({ ...selectedTeams, [teamName]: selectedTeam });
    }
  }

  function handleUnselectTeam(teamName: string) {
    setSelectedTeams(_.omit(selectedTeams, teamName));
  }

  function getSingleUserMaybe(selectedUserIds: Key[], users: APIUser[]): APIUser | undefined {
    if (selectedUserIds.length === 1) {
      return users.find((_user) => _user.id === selectedUserIds[0]);
    }

    return undefined;
  }

  function getTeamComponent(team: APITeam, isDisabled: boolean) {
    return (
      <Checkbox
        value={team.name}
        checked={_.has(selectedTeams, team.name)}
        disabled={isDisabled}
        onChange={(event) => {
          if (event.target.checked) {
            handleSelectTeamRole(team.name, false);
          } else {
            handleUnselectTeam(team.name);
          }
        }}
      >
        {team.name}
      </Checkbox>
    );
  }

  function getRoleComponent(team: APITeam, isDisabled: boolean) {
    const selectedTeam = selectedTeams[team.name];
    let selectedValue = null;

    if (selectedTeam) {
      selectedValue = selectedTeam.isTeamManager ? ROLES.teammanager : ROLES.user;
    }

    return (
      <RadioGroup
        size="small"
        style={{
          width: "100%",
          paddingBottom: 8,
        }}
        value={selectedValue}
        disabled={!_.has(selectedTeams, team.name) || isDisabled}
        onChange={({ target: { value } }) =>
          handleSelectTeamRole(team.name, value === ROLES.teammanager)
        }
      >
        <RadioButton value={ROLES.teammanager}>Team Manager</RadioButton>
        <RadioButton value={ROLES.user}>Member</RadioButton>
      </RadioGroup>
    );
  }

  function getPermissionSelection(onlyEditingSingleUser: boolean, isUserAdmin: boolean) {
    const roleStyle = {
      fontWeight: "bold",
    } as React.CSSProperties;
    const explanationStyle = {
      paddingBottom: 12,
      color: "var(--ant-color-text-secondary)",
    } as React.CSSProperties;
    return (
      <React.Fragment>
        <h4>
          Organization Permissions{" "}
          <a
            href="https://docs.webknossos.org/webknossos/users/index.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            <InfoCircleOutlined />
          </a>
        </h4>
        {!isUserAdmin && !onlyEditingSingleUser ? (
          <p>{messages["users.needs_admin_rights"]}</p>
        ) : null}
        {onlyEditingSingleUser ? (
          <Radio.Group
            name="permission-role"
            defaultValue={selectedPermission}
            value={selectedPermission}
            onChange={handlePermissionChanged}
            disabled={!isUserAdmin}
          >
            <Radio value={PERMISSIONS.admin}>
              <div style={roleStyle}>Admin</div>
              <div style={explanationStyle}>
                Full administration capabilities. View and edit all datasets.
              </div>
            </Radio>
            <Radio value={PERMISSIONS.datasetManager}>
              <div style={roleStyle}>Dataset Manager</div>
              <div style={explanationStyle}>
                No administration capabilities. View and edit all datasets.
              </div>
            </Radio>
            <Radio value={PERMISSIONS.member}>
              <div style={roleStyle}>Member</div>
              <div style={explanationStyle}>
                No special permissions. Dataset access based on team memberships.
              </div>
            </Radio>
          </Radio.Group>
        ) : (
          <p>{messages["users.multiple_selected_users"]}</p>
        )}
      </React.Fragment>
    );
  }

  const userIsAdmin = activeUser.isAdmin;
  const onlyEditingSingleUser = selectedUserIds.length === 1;
  const permissionEditingSection = getPermissionSelection(onlyEditingSingleUser, userIsAdmin);
  const isAdminSelected = selectedPermission === PERMISSIONS.admin;
  const teamsRoleComponents = teams.map((team) => (
    <Row key={team.id}>
      <Col span={12}>{getTeamComponent(team, isAdminSelected)}</Col>
      <Col span={12}>{getRoleComponent(team, isAdminSelected)}</Col>
    </Row>
  ));

  return (
    <Modal
      maskClosable={false}
      closable={false}
      open={isOpen}
      onCancel={onCancel}
      onOk={handleUpdatePermissionsAndTeams}
      okText="Set Teams &amp; Permissions"
    >
      {permissionEditingSection}
      <Divider />
      <h4>Team Permissions</h4>
      <div>
        <Row>
          <Col span={12}>
            <h4>Teams</h4>
          </Col>
          <Col span={12}>
            <h4>Role</h4>
          </Col>
        </Row>
        {teamsRoleComponents}
      </div>
    </Modal>
  );
}

export default PermissionsAndTeamsModalView;
