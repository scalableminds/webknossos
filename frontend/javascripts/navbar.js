// @flow
import { Avatar, Icon, Layout, Menu, Popover } from "antd";
import { Link, withRouter, type RouterHistory } from "react-router-dom";
import { connect } from "react-redux";
import React from "react";

import type { APIUser } from "types/api_flow_types";
import { PortalTarget } from "oxalis/view/layouting/portal_utils";
import {
  getBuildInfo,
  getSwitchableOrganizations,
  switchToOrganization,
} from "admin/admin_rest_api";
import { logoutUserAction } from "oxalis/model/actions/user_actions";
import { trackVersion } from "oxalis/model/helpers/analytics";
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
  hasOrganizations: boolean,
|};
type Props = {| ...OwnProps, ...StateProps |};
type PropsWithRouter = {|
  ...Props,
  history: RouterHistory,
|};

export const navbarHeight = 48;

// The user should click somewhere else to close that menu like it's done in most OS menus, anyway. 10 seconds.
const subMenuCloseDelay = 10;

function NavbarMenuItem({ children, ...props }) {
  return (
    <Menu
      mode="horizontal"
      style={{ lineHeight: "48px" }}
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
  return (
    <Avatar
      className="hover-effect-via-opacity"
      style={{ backgroundColor: "rgb(82, 196, 26)", verticalAlign: "middle" }}
    >
      {initialOf(firstName) + initialOf(lastName)}
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
      className={collapse ? "hide-on-small-screen" : ""}
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
      {features().jobsEnabled && (
        <Menu.Item key="/jobs">
          <Link to="/jobs">Processing Jobs</Link>
        </Menu.Item>
      )}
      <Menu.Item key="/scripts">
        <Link to="/scripts">Scripts</Link>
      </Menu.Item>
    </SubMenu>
  );
}

function StatisticsSubMenu({ collapse, ...menuProps }) {
  return (
    <SubMenu
      className={collapse ? "hide-on-small-screen" : ""}
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

function getTimeTrackingMenu({ collapse }) {
  return (
    <Menu.Item key="timeStatisticMenu">
      <Link to="/reports/timetracking" style={{ fontWeight: 400 }}>
        <CollapsibleMenuTitle
          title="Time Tracking"
          icon={<Icon type="bar-chart" />}
          collapse={collapse}
        />
      </Link>
    </Menu.Item>
  );
}

function HelpSubMenu({ isAdminOrTeamManager, version, collapse, ...other }) {
  return (
    <SubMenu
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
      {(!features().discussionBoardRequiresAdmin || isAdminOrTeamManager) &&
      features().discussionBoard !== false ? (
        <Menu.Item key="discussion-board">
          <a href={features().discussionBoard} target="_blank" rel="noopener noreferrer">
            Community Support
          </a>
        </Menu.Item>
      ) : null}
      <Menu.Item key="frontend-api">
        <a target="_blank" href="/assets/docs/frontend-api/index.html">
          Frontend API Documentation
        </a>
      </Menu.Item>
      <Menu.Item key="keyboard-shortcuts">
        <a
          target="_blank"
          href="https://docs.webknossos.org/reference/keyboard_shortcuts"
          rel="noopener noreferrer"
        >
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

function DashboardSubMenu({ collapse, ...other }) {
  return (
    <SubMenu
      className={collapse ? "hide-on-small-screen" : ""}
      key="dashboardMenu"
      title={
        <CollapsibleMenuTitle title="Dashboard" icon={<Icon type="home" />} collapse={collapse} />
      }
      {...other}
    >
      <Menu.Item key="/dashboard/datasets">
        <Link to="/dashboard/datasets">My Datasets</Link>
      </Menu.Item>
      <Menu.Item key="/dashboard/tasks">
        <Link to="/dashboard/tasks">My Tasks</Link>
      </Menu.Item>
      <Menu.Item key="/dashboard/annotations">
        <Link to="/dashboard/annotations">My Annotations</Link>
      </Menu.Item>
      <Menu.Item key="/dashboard/shared">
        <Link to="/dashboard/shared">Shared Annotations</Link>
      </Menu.Item>
    </SubMenu>
  );
}

function LoggedInAvatar({ activeUser, handleLogout, ...other }) {
  const { firstName, lastName, organization: organizationName } = activeUser;

  const switchableOrganizations = useFetch(getSwitchableOrganizations, [], []);

  const activeOrganization = switchableOrganizations.find(org => org.name === organizationName);
  const orgDisplayName =
    activeOrganization != null
      ? activeOrganization.displayName || activeOrganization.name
      : organizationName;

  const switchTo = async org => {
    await switchToOrganization(org.name);
  };

  return (
    <NavbarMenuItem>
      <SubMenu
        key="loggedMenu"
        title={<UserInitials activeUser={activeUser} />}
        style={{ padding: 0 }}
        className="sub-menu-without-padding vertical-center-flex-fix"
        {...other}
      >
        <Menu.Item disabled key="userName">
          {`${firstName} ${lastName}`}
        </Menu.Item>
        <Menu.Item disabled key="organization">
          {orgDisplayName}
        </Menu.Item>
        <Menu.Item key="resetpassword">
          <Link to="/auth/changePassword">Change Password</Link>
        </Menu.Item>
        <Menu.SubMenu title="Switch Organization">
          {switchableOrganizations.map(org => (
            <Menu.Item key={org.name} onClick={() => switchTo(org)}>
              {org.displayName || org.name}
            </Menu.Item>
          ))}
        </Menu.SubMenu>
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
      style={{ position: "fixed" }}
    >
      <Avatar className="hover-effect-via-opacity" icon="user" style={{ marginLeft: 8 }} />
    </Popover>
  );
}

async function getAndTrackVersion() {
  const buildInfo = await getBuildInfo();
  const { version } = buildInfo.webknossos;
  trackVersion(version);
  return version;
}

function Navbar({
  activeUser,
  isAuthenticated,
  history,
  isInAnnotationView,
  hasOrganizations,
}: PropsWithRouter) {
  const handleLogout = async () => {
    await Request.receiveJSON("/api/auth/logout");
    Store.dispatch(logoutUserAction());
  };

  const version = useFetch(getAndTrackVersion, null, []);

  const navbarStyle: Object = {
    padding: 0,
    overflowX: "auto",
    position: "fixed",
    width: "100%",
    zIndex: 1000,
    height: navbarHeight,
    display: "flex",
    alignItems: "center",
    color: "rgba(255, 255, 255, 0.67)",
    background: "#001529",
    whiteSpace: "nowrap",
  };

  const _isAuthenticated = isAuthenticated && activeUser != null;
  const isAdminOrTeamManager =
    activeUser != null ? Utils.isUserAdminOrTeamManager(activeUser) : false;

  const collapseAllNavItems = isInAnnotationView;
  const hideNavbarLogin = features().hideNavbarLogin || !hasOrganizations;

  const menuItems = [];
  const trailingNavItems = [];

  if (_isAuthenticated) {
    // $FlowIssue[incompatible-type] Flow doesn't check that the activeUser cannot be empty here
    const loggedInUser: APIUser = activeUser;
    menuItems.push(<DashboardSubMenu key="dashboard" collapse={collapseAllNavItems} />);

    if (isAdminOrTeamManager) {
      menuItems.push(<AdministrationSubMenu key="admin" collapse={collapseAllNavItems} />);
      menuItems.push(<StatisticsSubMenu key="stats" collapse={collapseAllNavItems} />);
    } else {
      // JSX can not be used here directly as it adds a item between the menu and the actual menu item and this leads to a bug.
      menuItems.push(getTimeTrackingMenu({ collapse: collapseAllNavItems }));
    }

    trailingNavItems.push(
      <LoggedInAvatar
        key="logged-in-avatar"
        activeUser={loggedInUser}
        handleLogout={handleLogout}
      />,
    );
  }

  if (!_isAuthenticated && features().isDemoInstance && !Utils.getIsInIframe()) {
    menuItems.push(
      <Menu.Item key="features">
        <Link to="/features" style={{ fontWeight: 400 }}>
          <Icon type="rocket" /> Features
        </Link>
      </Menu.Item>,
      <Menu.Item key="pricing">
        <Link to="/pricing" style={{ fontWeight: 400 }}>
          <Icon type="trophy" /> Pricing
        </Link>
      </Menu.Item>,
    );
  }

  if (!(_isAuthenticated || hideNavbarLogin)) {
    trailingNavItems.push(<AnonymousAvatar key="anonymous-avatar" />);
  }

  menuItems.push(
    <HelpSubMenu
      key="helpMenu"
      version={version}
      isAdminOrTeamManager={isAdminOrTeamManager}
      collapse={collapseAllNavItems}
    />,
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
    <Header style={navbarStyle} className={collapseAllNavItems ? "collapsed-nav-header" : ""}>
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
  hasOrganizations: state.uiInformation.hasOrganizations,
});

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(withRouter(Navbar));
