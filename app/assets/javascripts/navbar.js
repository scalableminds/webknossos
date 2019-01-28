// @flow
/* eslint-disable react/prefer-stateless-function */

import { Layout, Menu, Icon } from "antd";
import { Link, type RouterHistory, withRouter } from "react-router-dom";
import { connect } from "react-redux";
import React from "react";

import type { APIUser } from "admin/api_flow_types";
import { getBuildInfo } from "admin/admin_rest_api";
import { logoutUserAction } from "oxalis/model/actions/user_actions";
import LoginView from "admin/auth/login_view";
import Request from "libs/request";
import Store, { type OxalisState } from "oxalis/store";
import * as Utils from "libs/utils";
import features from "features";

const { SubMenu } = Menu;
const { Header } = Layout;

type OwnProps = {|
  isAuthenticated: boolean,
|};
type StateProps = {|
  activeUser: ?APIUser,
|};
type Props = {| ...OwnProps, ...StateProps |};
type PropsWithRouter = {| ...Props, history: RouterHistory |};

type State = {
  version: ?string,
};

export const navbarHeight = 48;

class Navbar extends React.PureComponent<PropsWithRouter, State> {
  state = {
    version: null,
  };

  async componentWillMount() {
    const buildInfo = await getBuildInfo();
    this.setState({
      version: buildInfo.webknossos.version,
    });
  }

  handleLogout = async () => {
    await Request.receiveJSON("/api/auth/logout");
    Store.dispatch(logoutUserAction());
  };

  render() {
    const navbarStyle: Object = {
      padding: 0,
      position: "fixed",
      width: "100%",
      zIndex: 1000,
      height: navbarHeight,
      display: "flex",
      alignItems: "center",
      color: "rgba(255, 255, 255, 0.67)",
      background: "#001529",
    };
    // used to adjust the height in login view
    if (!this.props.activeUser) {
      navbarStyle.paddingTop = 4;
      navbarStyle.height = "auto";
    }
    const isAuthenticated = this.props.isAuthenticated && this.props.activeUser != null;
    const isAdmin =
      this.props.activeUser != null ? Utils.isUserAdmin(this.props.activeUser) : false;

    const helpMenu = (
      <SubMenu
        key="sub3"
        title={
          <span>
            <Icon type="medicine-box" />
            Help
          </span>
        }
      >
        <Menu.Item key="user-documentation">
          <a target="_blank" href="https://docs.webknossos.org" rel="noopener noreferrer">
            User Documentation
          </a>
        </Menu.Item>
        {(!features().discussionBoardRequiresAdmin || isAdmin) &&
        features().discussionBoard !== false ? (
          <Menu.Item key="discussion-board">
            <a href={features().discussionBoard} target="_blank" rel="noopener noreferrer">
              Community Support
            </a>
          </Menu.Item>
        ) : null}
        <Menu.Item key="frontend-api">
          <a target="_blank" href="/docs/frontend-api/index.html">
            Frontend API Documentation
          </a>
        </Menu.Item>
        <Menu.Item key="keyboard-shortcuts">
          <a target="_blank" href="/help/keyboardshortcuts" rel="noopener noreferrer">
            Keyboard Shortcuts
          </a>
        </Menu.Item>
        <Menu.Item key="credits">
          <a target="_blank" href="https://webknossos.org" rel="noopener noreferrer">
            About & Credits
          </a>
        </Menu.Item>
        {this.state.version !== "" ? (
          <Menu.Item disabled key="version">
            Version: {this.state.version}
          </Menu.Item>
        ) : null}
      </SubMenu>
    );

    const menuItems = [];
    menuItems.push(
      <Menu.Item key="/dashboard">
        <Link to="/dashboard">
          <Icon type="home" />
          Dashboard
        </Link>
      </Menu.Item>,
    );

    if (isAdmin) {
      menuItems.push(
        <SubMenu
          key="sub1"
          title={
            <span>
              <Icon type="setting" />
              Administration
            </span>
          }
        >
          <Menu.Item key="/users">
            <Link to="/users">Users</Link>
          </Menu.Item>
          <Menu.Item key="/teams">
            <Link to="/teams">Teams</Link>
          </Menu.Item>
          <Menu.Item key="/projects">
            <Link to="/projects">Projects</Link>
          </Menu.Item>
          <Menu.Item key="/tasks">
            <Link to="/tasks">Tasks</Link>
          </Menu.Item>
          <Menu.Item key="/taskTypes">
            <Link to="/taskTypes">Task Types</Link>
          </Menu.Item>
          <Menu.Item key="/scripts">
            <Link to="/scripts">Scripts</Link>
          </Menu.Item>
        </SubMenu>,
        <SubMenu
          key="sub2"
          title={
            <span>
              <Icon type="line-chart" />
              Statistics
            </span>
          }
        >
          <Menu.Item key="/statistics">
            <Link to="/statistics">Statistics</Link>
          </Menu.Item>
          <Menu.Item key="/reports/timetracking">
            <Link to="/reports/timetracking">Time Tracking</Link>
          </Menu.Item>
          <Menu.Item key="/reports/projectProgress">
            <Link to="/reports/projectProgress">Project Progress</Link>
          </Menu.Item>
          <Menu.Item key="/reports/openTasks">
            <Link to="/reports/openTasks">Open Tasks</Link>
          </Menu.Item>
        </SubMenu>,
      );
    }

    menuItems.push(helpMenu);

    return (
      <Header style={navbarStyle}>
        <Menu
          mode="horizontal"
          defaultSelectedKeys={[this.props.history.location.pathname]}
          style={{ lineHeight: "48px", flex: isAuthenticated ? "1" : undefined }}
          theme="dark"
        >
          <Menu.Item key="0">
            <Link to="/" style={{ fontWeight: 400 }}>
              <span className="logo" />
              webKnossos
            </Link>
          </Menu.Item>
          {isAuthenticated && this.props.activeUser != null
            ? menuItems.concat([
                <SubMenu
                  key="sub4"
                  className="pull-right"
                  title={
                    <span>
                      <Icon type="user" />
                      {`${this.props.activeUser.firstName} ${this.props.activeUser.lastName}`}
                    </span>
                  }
                >
                  <Menu.Item key="resetpassword">
                    <Link to="/auth/changePassword">Change Password</Link>
                  </Menu.Item>
                  <Menu.Item key="token">
                    <Link to="/auth/token">Auth Token</Link>
                  </Menu.Item>
                  <Menu.Item key="logout">
                    <Link to="/" onClick={this.handleLogout}>
                      Logout
                    </Link>
                  </Menu.Item>
                </SubMenu>,
              ])
            : helpMenu}
        </Menu>
        {!(isAuthenticated || features().hideNavbarLogin) ? (
          <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
            <LoginView layout="inline" redirect={this.props.history.location.pathname} />
          </div>
        ) : null}
      </Header>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
});

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(withRouter(Navbar));
