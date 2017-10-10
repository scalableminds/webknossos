import React from "react";
import { Layout, Menu, Icon } from "antd";
import { Link } from "react-router-dom";

const { SubMenu } = Menu;
const { Header } = Layout;

class Navbar extends React.PureComponent {
  render() {
    return (
      <Header style={{ padding: 0 }}>
        <Menu
          mode="horizontal"
          defaultSelectedKeys={["2"]}
          style={{ lineHeight: "64px" }}
          theme="dark"
        >
          <Menu.Item key="0">
            <Link to="/dashboard" style={{ fontWeight: 400 }}>
              <span className="logo" />
              webKnossos
            </Link>
          </Menu.Item>
          <Menu.Item key="1">
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
            <Menu.Item key="2">
              <Link to="/users">Users</Link>
            </Menu.Item>
            <Menu.Item key="3">
              <Link to="/teams">Teams</Link>
            </Menu.Item>
            <Menu.Item key="4">
              <Link to="/projects">Projects</Link>
            </Menu.Item>
            <Menu.Item key="5">
              <Link to="/tasks">Tasks</Link>
            </Menu.Item>
            <Menu.Item key="6">
              <Link to="/taskTypes">Task Types</Link>
            </Menu.Item>
            <Menu.Item key="7">
              <Link to="/scripts">Scripts</Link>
            </Menu.Item>
          </SubMenu>

          <SubMenu
            key="sub2"
            title={
              <span>
                <Icon type="line-chart" />Statistics
              </span>
            }
          >
            <Menu.Item key="8">
              <Link to="/tasks/overview">Overview</Link>
            </Menu.Item>
            <Menu.Item key="9">
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
            <Menu.Item key="10">
              <a target="_blank" href="/help/faq">
                FAQ
              </a>
            </Menu.Item>
            <Menu.Item key="11">
              <a target="_blank" href="/assets/docs/frontend-api/index.html">
                Frontend API Documentation
              </a>
            </Menu.Item>
            <Menu.Item key="12">
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
