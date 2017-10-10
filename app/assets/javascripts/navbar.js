import React from "react";
import { Layout, Menu, Icon } from "antd";
import { Link } from "react-router-dom";
import app from "app";

const { SubMenu } = Menu;
const { Header } = Layout;

class Navbar extends React.PureComponent {
  render() {
    return (
      <Header style={{ padding: 0 }}>
        <Menu
          mode="horizontal"
          defaultSelectedKeys={[app.history.location.pathname]}
          style={{ lineHeight: "64px" }}
          theme="dark"
        >
          <Menu.Item key="0">
            <Link to="/dashboard" style={{ fontWeight: 400 }}>
              <span className="logo" />
              webKnossos
            </Link>
          </Menu.Item>
          <Menu.Item key="/dashboard">
            <Link to="/dashboard">
              <Icon type="home" />
              Dashboard
            </Link>
          </Menu.Item>

          <SubMenu
            key="sub1"
            title={
              <span>
                <Icon type="setting" />Administration
              </span>
            }
          >
            <Menu.Item key="/users">
              {" "}
              <Link to="/users">Users</Link>
            </Menu.Item>
            <Menu.Item key="/teams">
              {" "}
              <Link to="/teams">Teams</Link>
            </Menu.Item>
            <Menu.Item key="/projects">
              {" "}
              <Link to="/projects">Projects</Link>
            </Menu.Item>
            <Menu.Item key="/tasks">
              {" "}
              <Link to="/tasks">Tasks</Link>
            </Menu.Item>
            <Menu.Item key="/taskTypes">
              {" "}
              <Link to="/taskTypes">Task Types</Link>
            </Menu.Item>
            <Menu.Item key="/scripts">
              {" "}
              <Link to="/scripts">Scripts</Link>
            </Menu.Item>
          </SubMenu>

          <SubMenu
            KEY="sub2"
            title={
              <span>
                <Icon type="line-chart" />Statistics
              </span>
            }
          >
            <Menu.Item key="/tasks/overview">
              <Link to="/tasks/overview">Overview</Link>
            </Menu.Item>
            <Menu.Item key="/statistics">
              <Link to="/statistics">Weekly</Link>
            </Menu.Item>
          </SubMenu>

          <SubMenu
            key="sub3"
            title={
              <span>
                <Icon type="medicine-box" />Help
              </span>
            }
          >
            <Menu.Item key="/help/faq">
              <a target="_blank" href="/help/faq">
                FAQ
              </a>
            </Menu.Item>
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
          </SubMenu>

          <Menu.Item key="13">
            <a href="https://discuss.webknossos.org" target="_blank">
              <Icon type="notification" />
              Discussion Board
            </a>
          </Menu.Item>
        </Menu>
      </Header>
    );
  }
}

export default Navbar;
