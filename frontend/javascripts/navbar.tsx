import { Avatar, Button, Badge, Tooltip, Layout, Menu, Popover, type SubMenuProps } from "antd";
import {
  SwapOutlined,
  TeamOutlined,
  CheckOutlined,
  BarChartOutlined,
  HomeOutlined,
  QuestionCircleOutlined,
  UserOutlined,
  BellOutlined,
} from "@ant-design/icons";
import { useHistory, Link } from "react-router-dom";

import classnames from "classnames";
import { connect } from "react-redux";
import React, { useState, useEffect } from "react";
import Toast from "libs/toast";
import type { APIOrganization, APIUser, APIUserTheme } from "types/api_flow_types";
import { PortalTarget } from "oxalis/view/layouting/portal_utils";
import {
  getBuildInfo,
  getUsersOrganizations,
  switchToOrganization,
  updateSelectedThemeOfUser,
  updateNovelUserExperienceInfos,
  sendAnalyticsEvent,
} from "admin/admin_rest_api";
import { logoutUserAction, setActiveUserAction } from "oxalis/model/actions/user_actions";
import { trackVersion } from "oxalis/model/helpers/analytics";
import { useFetch, useInterval } from "libs/react_helpers";
import LoginForm from "admin/auth/login_form";
import Request from "libs/request";
import type { OxalisState } from "oxalis/store";
import Store from "oxalis/store";
import * as Utils from "libs/utils";
import window, { document, location } from "libs/window";
import features from "features";
import { setThemeAction } from "oxalis/model/actions/ui_actions";
import { HelpModal } from "oxalis/view/help_modal";

const { SubMenu } = Menu;
const { Header } = Layout;

const HELP_MENU_KEY = "helpMenu";

type OwnProps = {
  isAuthenticated: boolean;
};
type StateProps = {
  activeUser: APIUser | null | undefined;
  isInAnnotationView: boolean;
  hasOrganizations: boolean;
};
type Props = OwnProps & StateProps;
export const navbarHeight = 48;
// The user should click somewhere else to close that menu like it's done in most OS menus, anyway. 10 seconds.
const subMenuCloseDelay = 10;

function useOlvy() {
  const [isInitialized, setIsInitialized] = useState(false);
  // Initialize Olvy after mounting
  useEffect(() => {
    if (!features().isDemoInstance) {
      return;
    }

    const OlvyConfig = {
      organisation: "webknossos",
      // This target needs to be defined (otherwise, Olvy crashes when using .show()). However,
      // we don't want Olvy to add any notification icons, since we do this on our own. Therefore,
      // provide a dummy value here.
      target: "#unused-olvy-target",
      type: "modal",
      view: {
        showSearch: false,
        compact: false,
        showHeader: true,
        // only applies when widget type is embed. you cannot hide header for modal and sidebar widgets
        showUnreadIndicator: false,
        unreadIndicatorColor: "#cc1919",
        unreadIndicatorPosition: "top-right",
      },
    };

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'Olvy' does not exist on type '(Window & ... Remove this comment to see the full error message
    if (window.Olvy != null) {
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'Olvy' does not exist on type '(Window & ... Remove this comment to see the full error message
      window.Olvy.init(OlvyConfig);
      setIsInitialized(true);
    }
  }, []);
  return isInitialized;
}

function useOlvyUnreadReleasesCount(activeUser: APIUser) {
  const lastViewedTimestampWithFallback =
    activeUser.novelUserExperienceInfos.lastViewedWhatsNewTimestamp != null
      ? activeUser.novelUserExperienceInfos.lastViewedWhatsNewTimestamp
      : activeUser.created;
  const isInitialized = useOlvy();
  const unreadCount = useFetch(
    async () => {
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'Olvy' does not exist on type '(Window & ... Remove this comment to see the full error message
      if (!isInitialized || !features().isDemoInstance || !window.Olvy) {
        return null;
      }

      // @ts-expect-error ts-migrate(2339) FIXME: Property 'Olvy' does not exist on type '(Window & ... Remove this comment to see the full error message
      return window.Olvy.getUnreadReleasesCount(
        new Date(lastViewedTimestampWithFallback).toISOString(),
      );
    },
    null,
    [isInitialized, lastViewedTimestampWithFallback],
  );
  return unreadCount;
}

// @ts-expect-error ts-migrate(7031) FIXME: Binding element 'children' implicitly has an 'any'... Remove this comment to see the full error message
function NavbarMenuItem({ children, ...props }) {
  return (
    <Menu
      mode="horizontal"
      style={{
        lineHeight: "48px",
      }}
      theme="dark"
      subMenuCloseDelay={subMenuCloseDelay}
      triggerSubMenuAction="click"
      {...props}
    >
      {children}
    </Menu>
  );
}

function UserInitials({
  activeUser,
  isMultiMember,
}: {
  activeUser: APIUser;
  isMultiMember: boolean;
}) {
  const { firstName, lastName } = activeUser;

  const initialOf = (str: string) => str.slice(0, 1).toUpperCase();

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
      }}
    >
      <Avatar
        className="hover-effect-via-opacity"
        style={{
          backgroundColor: "rgb(82, 196, 26)",
          verticalAlign: "middle",
        }}
      >
        {initialOf(firstName) + initialOf(lastName)}
      </Avatar>

      {isMultiMember ? (
        <SwapOutlined
          style={{
            position: "absolute",
            top: 2,
            right: -5,
            marginRight: 0,
            minWidth: 12,
            height: 12,
            lineHeight: "12px",
            fontSize: 12,
            color: "#75df4a",
          }}
          title="You are member of multiple organizations. Click the avatar to switch between them."
        />
      ) : null}
    </div>
  );
}

function CollapsibleMenuTitle({
  title,
  collapse,
  icon,
}: {
  title: string;
  collapse: boolean;
  icon: any;
}) {
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

function AdministrationSubMenu({
  collapse,
  isAdmin,
  organization,
  ...menuProps
}: { collapse: boolean; isAdmin: boolean; organization: string } & SubMenuProps) {
  return (
    <SubMenu
      className={collapse ? "hide-on-small-screen" : ""}
      key="adminMenu"
      title={
        <CollapsibleMenuTitle title="Administration" icon={<TeamOutlined />} collapse={collapse} />
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
      {isAdmin && (
        <Menu.Item key="/organization">
          <Link to={`/organizations/${organization}/edit`}>Organization</Link>
        </Menu.Item>
      )}
      {features().voxelyticsEnabled && (
        <Menu.Item key="/workflows">
          <Link to="/workflows">Voxelytics</Link>
        </Menu.Item>
      )}
    </SubMenu>
  );
}

function StatisticsSubMenu({ collapse, ...menuProps }: { collapse: boolean } & SubMenuProps) {
  return (
    <SubMenu
      className={collapse ? "hide-on-small-screen" : ""}
      key="statisticMenu"
      title={
        <CollapsibleMenuTitle title="Statistics" icon={<BarChartOutlined />} collapse={collapse} />
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

function getTimeTrackingMenu({ collapse }: { collapse: boolean }) {
  return (
    <Menu.Item key="timeStatisticMenu">
      <Link
        to="/reports/timetracking"
        style={{
          fontWeight: 400,
        }}
      >
        <CollapsibleMenuTitle
          title="Time Tracking"
          icon={<BarChartOutlined />}
          collapse={collapse}
        />
      </Link>
    </Menu.Item>
  );
}

function HelpSubMenu({
  isAuthenticated,
  isAdminOrTeamManager,
  version,
  polledVersion,
  collapse,
  ...other
}: {
  isAuthenticated: boolean;
  isAdminOrTeamManager: boolean;
  version: string | null;
  polledVersion: string | null;
  collapse: boolean;
} & SubMenuProps) {
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);

  return (
    <SubMenu
      title={
        <CollapsibleMenuTitle title="Help" icon={<QuestionCircleOutlined />} collapse={collapse} />
      }
      {...other}
    >
      <Menu.Item key="user-documentation">
        <a target="_blank" href="https://docs.webknossos.org" rel="noreferrer noopener">
          User Documentation
        </a>
      </Menu.Item>
      {(!features().discussionBoardRequiresAdmin || isAdminOrTeamManager) &&
      features().discussionBoard !== false ? (
        <Menu.Item key="discussion-board">
          <a href={features().discussionBoard} target="_blank" rel="noreferrer noopener">
            Community Support
          </a>
        </Menu.Item>
      ) : null}
      <Menu.Item key="frontend-api">
        <a target="_blank" href="/assets/docs/frontend-api/index.html" rel="noopener noreferrer">
          Frontend API Documentation
        </a>
      </Menu.Item>
      <Menu.Item key="keyboard-shortcuts">
        <a
          target="_blank"
          href="https://docs.webknossos.org/webknossos/keyboard_shortcuts.html"
          rel="noopener noreferrer"
        >
          Keyboard Shortcuts
        </a>
      </Menu.Item>
      {isAuthenticated ? (
        <>
          <Menu.Item key="get_help" onClick={() => setIsHelpModalOpen(true)}>
            Ask a Question
          </Menu.Item>
          <HelpModal
            isModalOpen={isHelpModalOpen}
            onCancel={() => setIsHelpModalOpen(false)}
            centeredLayout
          />
        </>
      ) : null}
      {features().isDemoInstance ? (
        <Menu.Item key="contact">
          <a target="_blank" href="mailto:hello@webknossos.org" rel="noopener noreferrer">
            Email Us
          </a>
        </Menu.Item>
      ) : (
        <Menu.Item key="credits">
          <a target="_blank" href="https://webknossos.org" rel="noopener noreferrer">
            About & Credits
          </a>
        </Menu.Item>
      )}
      {version !== "" ? (
        <Menu.Item disabled key="version">
          Version: {version}
          {polledVersion != null && polledVersion !== version
            ? ` (Server is currently at ${polledVersion}!)`
            : null}
        </Menu.Item>
      ) : null}
    </SubMenu>
  );
}

function DashboardSubMenu({ collapse, ...other }: { collapse: boolean } & SubMenuProps) {
  return (
    <SubMenu
      className={collapse ? "hide-on-small-screen" : ""}
      key="dashboardMenu"
      title={<CollapsibleMenuTitle title="Dashboard" icon={<HomeOutlined />} collapse={collapse} />}
      {...other}
    >
      <Menu.Item key="/dashboard/datasets">
        <Link to="/dashboard/datasets">Datasets</Link>
      </Menu.Item>
      <Menu.Item key="/dashboard/tasks">
        <Link to="/dashboard/tasks">Tasks</Link>
      </Menu.Item>
      <Menu.Item key="/dashboard/annotations">
        <Link to="/dashboard/annotations">Annotations</Link>
      </Menu.Item>
    </SubMenu>
  );
}

function NotificationIcon({ activeUser }: { activeUser: APIUser }) {
  const maybeUnreadReleaseCount = useOlvyUnreadReleasesCount(activeUser);

  const handleShowWhatsNewView = () => {
    const [newUserSync] = updateNovelUserExperienceInfos(activeUser, {
      lastViewedWhatsNewTimestamp: new Date().getTime(),
    });
    Store.dispatch(setActiveUserAction(newUserSync));
    sendAnalyticsEvent("open_whats_new_view");

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'Olvy' does not exist on type '(Window & ... Remove this comment to see the full error message
    if (window.Olvy) {
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'Olvy' does not exist on type '(Window & ... Remove this comment to see the full error message
      window.Olvy.show();
    }
  };

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        marginRight: 12,
      }}
    >
      <Tooltip title="See what's new in webKnossos" placement="bottomLeft">
        <Badge count={maybeUnreadReleaseCount || 0} size="small">
          <Button
            onClick={handleShowWhatsNewView}
            shape="circle"
            icon={<BellOutlined className="without-icon-margin" />}
          />
        </Badge>
      </Tooltip>
    </div>
  );
}

function LoggedInAvatar({
  activeUser,
  handleLogout,
  ...other
}: { activeUser: APIUser; handleLogout: (event: React.SyntheticEvent) => void } & SubMenuProps) {
  const { firstName, lastName, organization: organizationName, selectedTheme } = activeUser;
  const usersOrganizations = useFetch(getUsersOrganizations, [], []);
  const activeOrganization = usersOrganizations.find((org) => org.name === organizationName);
  const switchableOrganizations = usersOrganizations.filter((org) => org.name !== organizationName);
  const orgDisplayName =
    activeOrganization != null
      ? activeOrganization.displayName || activeOrganization.name
      : organizationName;

  const switchTo = async (org: APIOrganization) => {
    Toast.info(`Switching to ${org.displayName || org.name}`);
    await switchToOrganization(org.name);
  };

  const setSelectedTheme = async (theme: APIUserTheme) => {
    let newTheme = theme;

    if (newTheme === "auto") {
      newTheme =
        // @ts-ignore
        window.matchMedia("(prefers-color-scheme: dark)").media !== "not all" &&
        // @ts-ignore
        window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    }

    const styleEl = document.getElementById("primary-stylesheet") as HTMLLinkElement;
    const oldThemeMatch = styleEl.href.match(/[a-z]+\.css/);
    const oldTheme = oldThemeMatch != null ? oldThemeMatch[0] : null;

    if (oldTheme !== newTheme) {
      const newStyleEl = styleEl.cloneNode();
      const parentEl = styleEl.parentNode;

      if (parentEl != null) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'href' does not exist on type 'Node'.
        newStyleEl.href = newStyleEl.href.replace(/[a-z]+\.css/, `${newTheme}.css`);
        newStyleEl.addEventListener(
          "load",
          () => {
            parentEl.removeChild(styleEl);
          },
          {
            once: true,
          },
        );
        parentEl.insertBefore(newStyleEl, styleEl);
        Store.dispatch(setThemeAction(newTheme));
      }
    }

    if (selectedTheme !== theme) {
      const newUser = await updateSelectedThemeOfUser(activeUser.id, theme);
      Store.dispatch(setActiveUserAction(newUser));
    }
  };

  const isMultiMember = switchableOrganizations.length > 0;
  return (
    <NavbarMenuItem>
      <SubMenu
        key="loggedMenu"
        title={<UserInitials activeUser={activeUser} isMultiMember={isMultiMember} />}
        style={{
          padding: 0,
        }}
        className="sub-menu-without-padding vertical-center-flex-fix"
        {...other}
      >
        <Menu.Item disabled key="userName">
          {`${firstName} ${lastName}`}
        </Menu.Item>
        <Menu.Item disabled key="organization">
          {orgDisplayName}
        </Menu.Item>
        {isMultiMember ? (
          /* The explicit width is a workaround for a layout bug (probably in antd) */
          <Menu.SubMenu
            title="Switch Organization"
            style={{
              width: 180,
            }}
          >
            {switchableOrganizations.map((org) => (
              <Menu.Item key={org.name} onClick={() => switchTo(org)}>
                {org.displayName || org.name}
              </Menu.Item>
            ))}
          </Menu.SubMenu>
        ) : null}
        <Menu.Item key="resetpassword">
          <Link to="/auth/changePassword">Change Password</Link>
        </Menu.Item>
        <Menu.Item key="token">
          <Link to="/auth/token">Auth Token</Link>
        </Menu.Item>
        <Menu.SubMenu title="Theme" key="theme">
          {[
            ["auto", "System-default"],
            ["light", "Light"],
            ["dark", "Dark"],
          ].map(([key, label]) => (
            <Menu.Item
              key={key}
              onClick={() => {
                // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string' is not assignable to par... Remove this comment to see the full error message
                setSelectedTheme(key);
              }}
            >
              {selectedTheme === key && <CheckOutlined />} {label}
            </Menu.Item>
          ))}
        </Menu.SubMenu>

        <Menu.Item key="logout">
          <a href="/" onClick={handleLogout}>
            Logout
          </a>
        </Menu.Item>
      </SubMenu>
    </NavbarMenuItem>
  );
}

function AnonymousAvatar() {
  return (
    <Popover
      placement="bottomRight"
      content={
        <LoginForm
          layout="horizontal"
          style={{
            maxWidth: 500,
          }}
        />
      }
      trigger="click"
      style={{
        position: "fixed",
      }}
    >
      <Avatar
        className="hover-effect-via-opacity"
        icon={<UserOutlined />}
        style={{
          marginLeft: 8,
        }}
      />
    </Popover>
  );
}

async function getAndTrackVersion(dontTrack: boolean = false) {
  const buildInfo = await getBuildInfo();
  const { version } = buildInfo.webknossos;
  if (dontTrack) {
    trackVersion(version);
  }
  return version;
}

function Navbar({ activeUser, isAuthenticated, isInAnnotationView, hasOrganizations }: Props) {
  const history = useHistory();

  const handleLogout = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    await Request.receiveJSON("/api/auth/logout");
    Store.dispatch(logoutUserAction());
    // Hard navigation
    location.href = "/";
  };

  const version = useFetch(getAndTrackVersion, null, []);
  const [isHelpMenuOpen, setIsHelpMenuOpen] = useState(false);
  const [polledVersion, setPolledVersion] = useState<string | null>(null);
  useInterval(
    async () => {
      if (isHelpMenuOpen) {
        setPolledVersion(await getAndTrackVersion(true));
      }
    },
    2000,
    isHelpMenuOpen,
  );
  const navbarStyle: Record<string, any> = {
    padding: 0,
    overflowX: "auto",
    overflowY: "hidden",
    position: "fixed",
    height: navbarHeight,
    display: "flex",
    alignItems: "center",
    whiteSpace: "nowrap",
  };

  const _isAuthenticated = isAuthenticated && activeUser != null;

  const isAdmin = activeUser != null ? Utils.isUserAdmin(activeUser) : false;
  const isAdminOrTeamManager =
    activeUser != null ? Utils.isUserAdminOrTeamManager(activeUser) : false;
  const collapseAllNavItems = isInAnnotationView;
  const hideNavbarLogin = features().hideNavbarLogin || !hasOrganizations;
  const menuItems = [];
  const trailingNavItems = [];

  if (_isAuthenticated) {
    const loggedInUser: APIUser = activeUser;
    menuItems.push(<DashboardSubMenu key="dashboard" collapse={collapseAllNavItems} />);

    if (isAdminOrTeamManager && activeUser != null) {
      menuItems.push(
        <AdministrationSubMenu
          key="admin"
          collapse={collapseAllNavItems}
          isAdmin={isAdmin}
          organization={activeUser.organization}
        />,
      );
      menuItems.push(<StatisticsSubMenu key="stats" collapse={collapseAllNavItems} />);
    } else {
      // JSX can not be used here directly as it adds a item between the menu and the actual menu item and this leads to a bug.
      menuItems.push(
        getTimeTrackingMenu({
          collapse: collapseAllNavItems,
        }),
      );
    }

    trailingNavItems.push(<NotificationIcon key="notification-icon" activeUser={loggedInUser} />);
    trailingNavItems.push(
      <LoggedInAvatar
        key="logged-in-avatar"
        activeUser={loggedInUser}
        handleLogout={handleLogout}
      />,
    );
  }

  if (!(_isAuthenticated || hideNavbarLogin)) {
    trailingNavItems.push(<AnonymousAvatar key="anonymous-avatar" />);
  }

  menuItems.push(
    <HelpSubMenu
      key={HELP_MENU_KEY}
      version={version}
      polledVersion={polledVersion}
      isAdminOrTeamManager={isAdminOrTeamManager}
      isAuthenticated={_isAuthenticated}
      collapse={collapseAllNavItems}
    />,
  );
  // Don't highlight active menu items, when showing the narrow version of the navbar,
  // since this makes the icons appear more crowded.
  const selectedKeys = collapseAllNavItems ? [] : [history.location.pathname];
  const separator = <div className="navbar-separator" />;
  return (
    <Header
      style={navbarStyle}
      className={classnames("navbar-header", {
        "collapsed-nav-header": collapseAllNavItems,
      })}
    >
      <Menu
        mode="horizontal"
        selectedKeys={selectedKeys}
        onOpenChange={(openKeys) => setIsHelpMenuOpen(openKeys.includes(HELP_MENU_KEY))}
        style={{
          lineHeight: "48px",
        }}
        theme="dark"
        subMenuCloseDelay={subMenuCloseDelay}
        triggerSubMenuAction="click"
        // There is a bug where the last menu entry disappears behind the overflow indicator
        // although there is ample space available, see https://github.com/ant-design/ant-design/issues/32277
        disabledOverflow
      >
        {[
          <Menu.Item key="0">
            <Link
              to="/dashboard"
              style={{
                fontWeight: 400,
              }}
            >
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

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginRight: 12,
        }}
      >
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

const connector = connect(mapStateToProps);
export default connector(Navbar);
