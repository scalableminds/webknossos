// @flow
/* eslint-disable react/prefer-stateless-function */

import React from "react";
import { Link, withRouter } from "react-router-dom";
import { Layout, Menu, Icon } from "antd";
import { connect } from "react-redux";
import Request from "libs/request";
import Utils from "libs/utils";
import LoginView from "admin/views/auth/login_view";

import type { OxalisState } from "oxalis/store";
import type { APIUserType } from "admin/api_flow_types";
import type { ReactRouterHistoryType } from "react_router";

const { SubMenu } = Menu;
const { Header } = Layout;

type StateProps = {
  activeUser: ?APIUserType,
};

type Props = {
  isAuthenticated: boolean,
  history: ReactRouterHistoryType,
} & StateProps;

class Navbar extends React.PureComponent<Props> {
  handleLogout = async () => {
    await Request.receiveJSON("/api/auth/logout");
    await Utils.sleep(500);
    window.location.reload();
  };

  render() {
    const navbarStyle = {
      padding: 0,
      position: "fixed",
      width: "100%",
      zIndex: 1000,
      height: 48,
      display: "flex",
      alignItems: "center",
      color: "rgba(255, 255, 255, 0.67)",
      background: "#404040",
    };

    const isAuthenticated = this.props.isAuthenticated && this.props.activeUser != null;

    return (
      <Header style={navbarStyle}>
        <Menu
          mode="horizontal"
          defaultSelectedkeys={[this.props.history.location.pathname]}
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
            ? [
                <Menu.Item key="/dashboard">
                  <Link to="/dashboard">
                    <Icon type="home" />
                    Dashboard
                  </Link>
                </Menu.Item>,
                <SubMenu
                  key="sub1"
                  title={
                    <span>
                      <Icon type="setting" />Administration
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
                <Menu.Item key="/statistics">
                  <Link to="/statistics">
                    <Icon type="line-chart" />Statistics
                  </Link>
                </Menu.Item>,
                <SubMenu
                  key="sub3"
                  title={
                    <span>
                      <Icon type="medicine-box" />Help
                    </span>
                  }
                >
                  <Menu.Item key="11">
                    <a target="_blank" href="/assets/docs/frontend-api/index.html">
                      Frontend API Documentation
                    </a>
                  </Menu.Item>
                  <Menu.Item key="/help/keyboardshortcuts">
                    <a target="_blank" href="/help/keyboardshortcuts">
                      Keyboard Shortcuts
                    </a>
                  </Menu.Item>
                </SubMenu>,
                <Menu.Item key="13">
                  <a
                    href="https://discuss.webknossos.org"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Icon type="notification" />
                    Discussion Board
                  </a>
                </Menu.Item>,
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
              ]
            : null}
        </Menu>
        {!isAuthenticated ? (
          <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
            <LoginView layout="inline" />
          </div>
        ) : null}
      </Header>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
});

export default withRouter(connect(mapStateToProps)(Navbar));
