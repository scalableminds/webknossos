// @flow
import { Avatar, Badge, Icon, Layout, Menu, Popover } from "antd";
import { Link, withRouter } from "react-router-dom";
import { connect } from "react-redux";
import React from "react";

import type { APIUser } from "admin/api_flow_types";
import { PortalTarget } from "oxalis/view/layouting/portal_utils";
import { getBuildInfo } from "admin/admin_rest_api";
import { logoutUserAction } from "oxalis/model/actions/user_actions";
import { trackVersion } from "oxalis/model/helpers/analytics";
import { useBooleanKnob, useTextKnob } from "retoggle";
import { useFetch } from "libs/react_helpers";
import LoginForm from "admin/auth/login_form";
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
  isInAnnotationView: boolean,
|};
type Props = {| ...OwnProps, ...StateProps |};

export const navbarHeight = 48;

// The user should click somewhere else to close that menu like it's done in most OS menus, anyway. 10 seconds.
const subMenuCloseDelay = 10;

function NavbarMenuItem({ children, style, ...props }) {
  return (
    <Menu
      mode="horizontal"
      style={{ ...style, lineHeight: "48px" }}
      theme="dark"
      subMenuCloseDelay={subMenuCloseDelay}
      triggerSubMenuAction="click"
      {...props}
    >
      {children}
    </Menu>
  );
}

function UserInitials({ activeUser }) {
  const { firstName, lastName } = activeUser;
  const initialOf = str => str.slice(0, 1).toUpperCase();
  const [userName] = useTextKnob("First Name", firstName);
  return (
    <Avatar
      className="hoverEffectViaOpacity"
      style={{ backgroundColor: "rgb(82, 196, 26)", verticalAlign: "middle" }}
    >
      {initialOf(userName) + initialOf(lastName)}
    </Avatar>
  );
}

function CollapsibleMenuTitle({ title, collapse, icon }) {
  if (collapse) {
    return <span title={title}>{icon}</span>;
  } else {
    return (
      <span>
        {icon}
        {title}
      </span>
    );
  }
}

function AdministrationSubMenu({ collapse, ...menuProps }) {
  return (
    <SubMenu
      key="adminMenu"
      title={
        <CollapsibleMenuTitle
          title="Administration"
          icon={<Icon type="team" />}
          collapse={collapse}
        />
      }
      {...menuProps}
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
    </SubMenu>
  );
}

function StatisticsSubMenu({ collapse, ...menuProps }) {
  return (
    <SubMenu
      key="statisticMenu"
      title={
        <CollapsibleMenuTitle
          title="Statistics"
          icon={<Icon type="bar-chart" />}
          collapse={collapse}
        />
      }
      {...menuProps}
    >
      <Menu.Item key="/statistics">
        <Link to="/statistics">Overview</Link>
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
    </SubMenu>
  );
}

function HelpSubMenu({ isAdmin, version, collapse, ...other }) {
  return (
    <SubMenu
      key="helpMenu"
      title={
        <CollapsibleMenuTitle
          title="Help"
          icon={<Icon type="question-circle" />}
          collapse={collapse}
        />
      }
      {...other}
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
        <a target="_blank" href="https://publication.webknossos.org" rel="noopener noreferrer">
          About & Credits
        </a>
      </Menu.Item>
      {version !== "" ? (
        <Menu.Item disabled key="version">
          Version: {version}
        </Menu.Item>
      ) : null}
    </SubMenu>
  );
}

function LoggedInAvatar({ activeUser, handleLogout, ...other }) {
  const { firstName, lastName } = activeUser;
  return (
    <NavbarMenuItem style={{ width: 30 }}>
      <SubMenu
        key="loggedMenu"
        title={<UserInitials activeUser={activeUser} />}
        style={{ padding: 0 }}
        className="subMenuWithoutPadding"
        {...other}
      >
        <Menu.Item disabled key="userName">
          {`${firstName} ${lastName}`}
        </Menu.Item>
        <Menu.Item key="resetpassword">
          <Link to="/auth/changePassword">Change Password</Link>
        </Menu.Item>
        <Menu.Item key="token">
          <Link to="/auth/token">Auth Token</Link>
        </Menu.Item>
        <Menu.Item key="logout">
          <Link to="/" onClick={handleLogout}>
            Logout
          </Link>
        </Menu.Item>
      </SubMenu>
    </NavbarMenuItem>
  );
}

function AnonymousAvatar() {
  return (
    <Popover
      placement="bottomRight"
      content={<LoginForm layout="horizontal" style={{ maxWidth: 500 }} />}
      trigger="click"
    >
      {/* Oh god, why -10? */}
      <div style={{ marginTop: -10, height: 48 }}>
        <Badge dot>
          <Avatar className="hoverEffectViaOpacity" icon="user" />
        </Badge>
      </div>
    </Popover>
  );
}

async function getAndTrackVersion() {
  const buildInfo = await getBuildInfo();
  const { version } = buildInfo.webknossos;
  trackVersion(version);
  return version;
}

function Navbar({ activeUser, isAuthenticated, history, isInAnnotationView }) {
  const handleLogout = async () => {
    await Request.receiveJSON("/api/auth/logout");
    Store.dispatch(logoutUserAction());
  };

  const version = useFetch(getAndTrackVersion, null, []);

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

  if (!activeUser) {
    navbarStyle.paddingTop = 4;
    navbarStyle.height = "auto";
  }
  const _isAuthenticated = isAuthenticated && activeUser != null;
  const isAdmin = activeUser != null ? Utils.isUserAdmin(activeUser) : false;

  const collapseAllNavItems = isInAnnotationView;
  const [hideNavbarLogin] = useBooleanKnob("Hide Navbar Login", features().hideNavbarLogin);

  const menuItems = [];
  const trailingNavItems = [];

  if (_isAuthenticated) {
    menuItems.push(
      <Menu.Item key="/dashboard">
        <Link to="/dashboard">
          <CollapsibleMenuTitle
            title="Dashboard"
            icon={<Icon type="home" />}
            collapse={collapseAllNavItems}
          />
        </Link>
      </Menu.Item>,
    );

    if (isAdmin) {
      menuItems.push(<AdministrationSubMenu collapse={collapseAllNavItems} />);
      menuItems.push(<StatisticsSubMenu collapse={collapseAllNavItems} />);
    }

    trailingNavItems.push(<LoggedInAvatar activeUser={activeUser} handleLogout={handleLogout} />);
  }

  if (!(_isAuthenticated || hideNavbarLogin)) {
    trailingNavItems.push(<AnonymousAvatar />);
  }

  menuItems.push(
    <HelpSubMenu version={version} isAdmin={isAdmin} collapse={collapseAllNavItems} />,
  );

  // Don't highlight active menu items, when showing the narrow version of the navbar,
  // since this makes the icons appear more crowded.
  const selectedKeys = collapseAllNavItems ? [] : [history.location.pathname];
  const separator = (
    <div
      style={{ height: "100%", marginLeft: 2, marginRight: 10, borderLeft: "1px #666879 solid" }}
    />
  );

  return (
    <Header style={navbarStyle} className={collapseAllNavItems ? "collapsedNavHeader" : ""}>
      <Menu
        mode="horizontal"
        selectedKeys={selectedKeys}
        style={{ lineHeight: "48px" }}
        theme="dark"
        subMenuCloseDelay={subMenuCloseDelay}
        triggerSubMenuAction="click"
      >
        {[
          <Menu.Item key="0">
            <Link to="/" style={{ fontWeight: 400 }}>
              <CollapsibleMenuTitle
                title="webKnossos"
                icon={<span className="logo" />}
                collapse={collapseAllNavItems}
              />
            </Link>
          </Menu.Item>,
        ].concat(menuItems)}
      </Menu>

      {isInAnnotationView ? separator : null}

      <PortalTarget
        portalId="navbarTracingSlot"
        style={{
          flex: 1,
          display: "flex",
        }}
      />

      <div style={{ display: "flex", justifyContent: "flex-end", marginRight: 12 }}>
        {trailingNavItems}
      </div>
    </Header>
  );
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
  isInAnnotationView: state.uiInformation.isInAnnotationView,
});

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(withRouter(Navbar));
