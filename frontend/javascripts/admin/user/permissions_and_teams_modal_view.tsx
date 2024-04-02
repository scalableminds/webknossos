import { Modal, Button, Radio, Col, Row, Checkbox, Divider, RadioChangeEvent } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
import * as React from "react";
import _ from "lodash";
import update from "immutability-helper";
import type { APIUser, APITeam, APITeamMembership } from "types/api_flow_types";
import { updateUser, getEditableTeams } from "admin/admin_rest_api";
import messages from "messages";
import * as Utils from "libs/utils";
import { Key } from "antd/lib/table/interface";
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
type TeamRoleModalProp = {
  onChange: (...args: Array<any>) => any;
  onCancel: (...args: Array<any>) => any;
  isOpen: boolean;
  selectedUserIds: Key[];
  users: Array<APIUser>;
  activeUser: APIUser;
};
type State = {
  teams: Array<APITeam>;
  selectedTeams: Record<string, APITeamMembership>;
  selectedPermission: string;
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

function getSingleUserMaybe(props: TeamRoleModalProp) {
  if (props.selectedUserIds.length === 1) {
    return props.users.find((_user) => _user.id === props.selectedUserIds[0]);
  }

  return false;
}

class PermissionsAndTeamsModalView extends React.PureComponent<TeamRoleModalProp, State> {
  state: State = {
    selectedTeams: {},
    teams: [],
    selectedPermission: PERMISSIONS.member,
  };

  componentDidMount() {
    this.fetchData();
  }

  componentDidUpdate(prevProps: TeamRoleModalProp) {
    if (
      prevProps.selectedUserIds !== this.props.selectedUserIds ||
      prevProps.users !== this.props.users
    ) {
      // If a single user is selected, pre-select his teams
      const singleUserMaybe = getSingleUserMaybe(this.props);

      if (singleUserMaybe) {
        const newSelectedTeams = _.keyBy(singleUserMaybe.teams, "name");

        const userPermission = getPermissionGroupOfUser(singleUserMaybe);
        this.setState({
          selectedTeams: newSelectedTeams,
          selectedPermission: userPermission,
        });
      }
    }
  }

  async fetchData() {
    const teams = await getEditableTeams();
    this.setState({
      teams,
    });
  }

  didPermissionsChange = () => {
    const singleUserMaybe = getSingleUserMaybe(this.props);

    if (!singleUserMaybe) {
      return false;
    }

    let previousPermission = PERMISSIONS.member;

    if (singleUserMaybe.isAdmin) {
      previousPermission = PERMISSIONS.admin;
    } else if (singleUserMaybe.isDatasetManager) {
      previousPermission = PERMISSIONS.datasetManager;
    }

    return previousPermission !== this.state.selectedPermission;
  };
  handleUpdatePermissionsAndTeams = () => {
    if (this.didPermissionsChange()) {
      const user = getSingleUserMaybe(this.props);

      if (user) {
        const userName = `${user.firstName} ${user.lastName}`;
        let message = messages["users.revoke_all_permissions"];

        if (this.state.selectedPermission === PERMISSIONS.admin) {
          message = messages["users.set_admin"];
        }

        if (this.state.selectedPermission === PERMISSIONS.datasetManager) {
          message = messages["users.set_dataset_manager"];
        }

        Modal.confirm({
          title: messages["users.change_permissions_title"],
          content: message({
            userName,
          }),
          onOk: this.setPermissionsAndTeams,
        });
      }
    } else {
      this.setPermissionsAndTeams();
    }
  };
  setPermissionsAndTeams = () => {
    const newUserPromises = this.props.users.map((user) => {
      if (this.props.selectedUserIds.includes(user.id)) {
        const newTeams = Utils.values(this.state.selectedTeams);
        const newUser = Object.assign({}, user, {
          teams: newTeams,
        });

        if (this.props.activeUser.isAdmin && this.props.selectedUserIds.length === 1) {
          // If the current user is admin and only one user is edited we also update the permissions.
          if (this.state.selectedPermission === PERMISSIONS.admin) {
            // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'isAdmin' because it is a read-on... Remove this comment to see the full error message
            newUser.isAdmin = true;
            // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'isDatasetManager' because it is ... Remove this comment to see the full error message
            newUser.isDatasetManager = false;
          } else if (this.state.selectedPermission === PERMISSIONS.datasetManager) {
            // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'isDatasetManager' because it is ... Remove this comment to see the full error message
            newUser.isDatasetManager = true;
            // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'isAdmin' because it is a read-on... Remove this comment to see the full error message
            newUser.isAdmin = false;
          } else {
            // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'isDatasetManager' because it is ... Remove this comment to see the full error message
            newUser.isDatasetManager = false;
            // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'isAdmin' because it is a read-on... Remove this comment to see the full error message
            newUser.isAdmin = false;
          }
        }

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
        this.props.onChange(newUsers);
      },
      () => {
        // do nothing and keep modal open
      },
    );
  };
  handlePermissionChanged = (evt: RadioChangeEvent) => {
    const selectedPermission: PERMISSIONS = evt.target.value;
    this.setState({
      selectedPermission,
    });
  };

  handleSelectTeamRole(teamName: string, isTeamManager: boolean) {
    const team = this.state.teams.find((t) => t.name === teamName);

    if (team) {
      const selectedTeam = {
        id: team.id,
        name: teamName,
        isTeamManager,
      };
      this.setState((prevState) => ({
        selectedTeams: update(prevState.selectedTeams, {
          [teamName]: {
            $set: selectedTeam,
          },
        }),
      }));
    }
  }

  handleUnselectTeam(teamName: string) {
    this.setState((prevState) => ({
      selectedTeams: update(prevState.selectedTeams, {
        $unset: [teamName],
      }),
    }));
  }

  getTeamComponent(team: APITeam, isDisabled: boolean) {
    return (
      <Checkbox
        value={team.name}
        checked={_.has(this.state.selectedTeams, team.name)}
        disabled={isDisabled}
        // @ts-expect-error ts-migrate(2322) FIXME: Type '(event: React.SyntheticEvent) => void' is no... Remove this comment to see the full error message
        onChange={(event: React.SyntheticEvent) => {
          // @ts-expect-error ts-migrate(2339) FIXME: Property 'checked' does not exist on type 'EventTa... Remove this comment to see the full error message
          if (event.target.checked) {
            this.handleSelectTeamRole(team.name, false);
          } else {
            this.handleUnselectTeam(team.name);
          }
        }}
      >
        {team.name}
      </Checkbox>
    );
  }

  getRoleComponent(team: APITeam, isDisabled: boolean) {
    const selectedTeam = this.state.selectedTeams[team.name];
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
        disabled={!_.has(this.state.selectedTeams, team.name) || isDisabled}
        onChange={({ target: { value } }) =>
          this.handleSelectTeamRole(team.name, value === ROLES.teammanager)
        }
      >
        <RadioButton value={ROLES.teammanager}>Team Manager</RadioButton>
        <RadioButton value={ROLES.user}>Member</RadioButton>
      </RadioGroup>
    );
  }

  getPermissionSelection(onlyEditingSingleUser: boolean, isUserAdmin: boolean) {
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
            href="https://docs.webknossos.org/webknossos/users.html"
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
            defaultValue={this.state.selectedPermission}
            value={this.state.selectedPermission}
            onChange={this.handlePermissionChanged}
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

  render() {
    const userIsAdmin = this.props.activeUser.isAdmin;
    const onlyEditingSingleUser = this.props.selectedUserIds.length === 1;
    const permissionEditingSection = this.getPermissionSelection(
      onlyEditingSingleUser,
      userIsAdmin,
    );
    const isAdminSelected = this.state.selectedPermission === PERMISSIONS.admin;
    const teamsRoleComponents = this.state.teams.map((team) => (
      <Row key={team.id}>
        <Col span={12}>{this.getTeamComponent(team, isAdminSelected)}</Col>
        <Col span={12}>{this.getRoleComponent(team, isAdminSelected)}</Col>
      </Row>
    ));
    return (
      <Modal
        maskClosable={false}
        closable={false}
        open={this.props.isOpen}
        onCancel={this.props.onCancel}
        footer={
          <div>
            <Button onClick={this.handleUpdatePermissionsAndTeams} type="primary">
              Set Teams &amp; Permissions
            </Button>
            <Button onClick={this.props.onCancel}>Cancel</Button>
          </div>
        }
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
}

export default PermissionsAndTeamsModalView;
