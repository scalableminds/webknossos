import {
  Avatar,
  Button,
  Badge,
  Tooltip,
  Layout,
  Menu,
  Popover,
  type SubMenuProps,
  Tag,
} from "antd";
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
import type { APIOrganization, APIUser, APIUserCompact, APIUserTheme } from "types/api_flow_types";
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
import { PricingPlanEnum } from "admin/organization/pricing_plan_utils";
import messages from "messages";
import { PricingEnforcedSpan } from "components/pricing_enforcers";
import { ItemType, MenuItemType, SubMenuType } from "antd/lib/menu/hooks/useItems";
import { MenuClickEventHandler } from "rc-menu/lib/interface";

const { Header } = Layout;

const HELP_MENU_KEY = "helpMenu";

type OwnProps = {
  isAuthenticated: boolean;
};
type StateProps = {
  activeUser: APIUser | null | undefined;
  isInAnnotationView: boolean;
  hasOrganizations: boolean;
  othersMayEdit: boolean;
  allowUpdate: boolean;
  blockedByUser: APIUserCompact | null | undefined;
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
          verticalAlign: "middle",
        }}
      >
        {initialOf(firstName) + initialOf(lastName)}
      </Avatar>

      {isMultiMember ? (
        <SwapOutlined
          className="switch-organization-icon"
          title="You are member of multiple organizations. Click the avatar to switch between them."
        />
      ) : null}
    </div>
  );
}

function getCollapsibleMenuTitle(
  title: string,
  icon: MenuItemType["icon"],
  collapse: boolean,
): MenuItemType["label"] {
  return collapse ? (
    <Tooltip title={title}>{icon}</Tooltip>
  ) : (
    <>
      {icon}
      {title}
    </>
  );
}

function getAdministrationSubMenu(
  collapse: boolean,
  isAdmin: boolean,
  organization: string,
): SubMenuType {
  const adminstrationSubMenuItems = [
    { key: "/users", label: <Link to="/users">Users</Link> },
    { key: "/teams", label: <Link to="/teams">Teams</Link> },
    {
      key: "/projects",
      label: (
        <PricingEnforcedSpan requiredPricingPlan={PricingPlanEnum.Team}>
          <Link to="/projects">Projects</Link>
        </PricingEnforcedSpan>
      ),
    },
    {
      key: "/tasks",
      label: (
        <PricingEnforcedSpan requiredPricingPlan={PricingPlanEnum.Team}>
          <Link to="/tasks">Tasks</Link>
        </PricingEnforcedSpan>
      ),
    },
    {
      key: "/taskTypes",
      label: (
        <PricingEnforcedSpan requiredPricingPlan={PricingPlanEnum.Team}>
          <Link to="/taskTypes">Task Types</Link>
        </PricingEnforcedSpan>
      ),
    },
    { key: "/scripts", label: <Link to="/scripts">Scripts</Link> },
  ];

  if (features().jobsEnabled)
    adminstrationSubMenuItems.push({
      key: "/jobs",
      label: <Link to="/jobs">Processing Jobs</Link>,
    });

  if (isAdmin)
    adminstrationSubMenuItems.push({
      key: "/organization",
      label: <Link to={`/organizations/${organization}`}>Organization</Link>,
    });

  if (features().voxelyticsEnabled)
    adminstrationSubMenuItems.push({
      key: "/workflows",
      label: <Link to="/workflows">Voxelytics</Link>,
    });

  return {
    key: "adminMenu",
    className: collapse ? "hide-on-small-screen" : "",
    label: getCollapsibleMenuTitle("Administration", <TeamOutlined />, collapse),
    children: adminstrationSubMenuItems,
  };
}

function getStatisticsSubMenu(collapse: boolean): SubMenuType {
  return {
    key: "statisticMenu",
    className: collapse ? "hide-on-small-screen" : "",
    label: getCollapsibleMenuTitle("Statistics", <BarChartOutlined />, collapse),
    children: [
      { key: "/statistics", label: <Link to="/statistics">Overview</Link> },
      {
        key: "/reports/timetracking",
        label: (
          <PricingEnforcedSpan requiredPricingPlan={PricingPlanEnum.Power}>
            <Link to="/reports/timetracking">Time Tracking</Link>
          </PricingEnforcedSpan>
        ),
      },
      {
        key: "/reports/projectProgress",
        label: (
          <PricingEnforcedSpan requiredPricingPlan={PricingPlanEnum.Team}>
            <Link to="/reports/projectProgress">Project Progress</Link>
          </PricingEnforcedSpan>
        ),
      },
      {
        key: "/reports/openTasks",
        label: (
          <PricingEnforcedSpan requiredPricingPlan={PricingPlanEnum.Team}>
            <Link to="/reports/openTasks">Open Tasks</Link>
          </PricingEnforcedSpan>
        ),
      },
    ],
  };
}

function getTimeTrackingMenu(collapse: boolean): MenuItemType {
  return {
    key: "timeStatisticMenu",

    label: (
      <Link
        to="/reports/timetracking"
        style={{
          fontWeight: 400,
        }}
      >
        {getCollapsibleMenuTitle("Time Tracking", <BarChartOutlined />, collapse)}
      </Link>
    ),
  };
}

function getHelpSubMenu(
  version: string | null,
  polledVersion: string | null,
  isAuthenticated: boolean,
  isAdminOrTeamManager: boolean,
  collapse: boolean,
  openHelpModal: MenuClickEventHandler,
) {
  const polledVersionString =
    polledVersion != null && polledVersion !== version
      ? `(Server is currently at ${polledVersion}!)`
      : "";

  const helpSubMenuItems: ItemType[] = [
    {
      key: "user-documentation",
      label: (
        <a target="_blank" href="https://docs.webknossos.org" rel="noreferrer noopener">
          User Documentation
        </a>
      ),
    },
    (!features().discussionBoardRequiresAdmin || isAdminOrTeamManager) &&
    features().discussionBoard !== false
      ? {
          key: "discussion-board",
          label: (
            <a href={features().discussionBoard} target="_blank" rel="noreferrer noopener">
              Community Support
            </a>
          ),
        }
      : null,
    {
      key: "frontend-api",
      label: (
        <a target="_blank" href="/assets/docs/frontend-api/index.html" rel="noopener noreferrer">
          Frontend API Documentation
        </a>
      ),
    },
    {
      key: "keyboard-shortcuts",
      label: (
        <a
          target="_blank"
          href="https://docs.webknossos.org/webknossos/keyboard_shortcuts.html"
          rel="noopener noreferrer"
        >
          Keyboard Shortcuts
        </a>
      ),
    },
  ];

  if (isAuthenticated)
    helpSubMenuItems.push({
      key: "get_help",
      onClick: openHelpModal,
      label: "Ask a Question",
    });

  if (features().isDemoInstance) {
    helpSubMenuItems.push({
      key: "contact",
      label: (
        <a target="_blank" href="mailto:hello@webknossos.org" rel="noopener noreferrer">
          Email Us
        </a>
      ),
    });
  } else {
    helpSubMenuItems.push({
      key: "credits",
      label: (
        <a target="_blank" href="https://webknossos.org" rel="noopener noreferrer">
          About & Credits
        </a>
      ),
    });
  }
  helpSubMenuItems.push({
    key: "imprint",
    label: (
      <a target="_blank" href="/imprint" rel="noopener noreferrer">
        Imprint
      </a>
    ),
  });
  helpSubMenuItems.push({
    key: "privacy",
    label: (
      <a target="_blank" href="/privacy" rel="noopener noreferrer">
        Privacy
      </a>
    ),
  });

  if (version !== "")
    helpSubMenuItems.push({
      key: "version",
      disabled: true,
      label: `Version: ${version} ${polledVersionString}`,
    });

  return {
    key: HELP_MENU_KEY,
    label: getCollapsibleMenuTitle("Help", <QuestionCircleOutlined />, collapse),
    children: helpSubMenuItems,
  };
}

function getDashboardSubMenu(collapse: boolean): SubMenuType {
  return {
    key: "dashboardMenu",
    className: collapse ? "hide-on-small-screen" : "",
    label: getCollapsibleMenuTitle("Dashboard", <HomeOutlined />, collapse),
    children: [
      { key: "/dashboard/datasets", label: <Link to="/dashboard/datasets">Datasets</Link> },
      { key: "/dashboard/tasks", label: <Link to="/dashboard/tasks">Tasks</Link> },
      {
        key: "/dashboard/annotations",
        label: <Link to="/dashboard/annotations">Annotations</Link>,
      },
    ],
  };
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
      <Tooltip title="See what's new in WEBKNOSSOS" placement="bottomLeft">
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

    // If the user is currently at the datasets tab, the active folder is encoded
    // in the URI. Switching to another organization means that the folder id
    // becomes invalid. That's why, we are removing any identifiers from the
    // current datasets path before reloading the page (which is done in
    // switchToOrganization).
    if (window.location.pathname.startsWith("/dashboard/datasets/")) {
      window.history.replaceState({}, "", "/dashboard/datasets/");
    }

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
    <Menu
      mode="horizontal"
      style={{
        lineHeight: "48px",
      }}
      theme="dark"
      subMenuCloseDelay={subMenuCloseDelay}
      triggerSubMenuAction="click"
      className="right-navbar"
      items={[
        {
          key: "loggedMenu",
          label: <UserInitials activeUser={activeUser} isMultiMember={isMultiMember} />,
          style: { padding: 0 },
          children: [
            {
              key: "userName",
              label: `${firstName} ${lastName}`,
              disabled: true,
            },
            {
              key: "organization",
              label: orgDisplayName,
              disabled: true,
            },
            activeOrganization && Utils.isUserAdmin(activeUser)
              ? {
                  key: "manage-organization",
                  label: (
                    <Link to={`/organizations/${activeOrganization.name}`}>
                      Manage Organization
                    </Link>
                  ),
                }
              : null,
            isMultiMember
              ? {
                  key: "switch-organization",
                  label: "Switch Organization",
                  children: switchableOrganizations.map((org) => ({
                    key: org.name,
                    onClick: () => switchTo(org),
                    label: org.displayName || org.name,
                  })),
                }
              : null,
            {
              key: "resetpassword",
              label: <Link to="/auth/changePassword">Change Password</Link>,
            },
            { key: "token", label: <Link to="/auth/token">Auth Token</Link> },
            {
              key: "theme",
              label: "Theme",
              children: [
                ["auto", "System-default"],
                ["light", "Light"],
                ["dark", "Dark"],
              ].map(([key, label]) => {
                return {
                  key,
                  label: label,
                  icon: selectedTheme === key ? <CheckOutlined /> : null,
                  onClick: () => {
                    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string' is not assignable to par... Remove this comment to see the full error message
                    setSelectedTheme(key);
                  },
                };
              }),
            },
            {
              key: "logout",
              label: (
                <a href="/" onClick={handleLogout}>
                  Logout
                </a>
              ),
            },
          ],
        },
      ]}
    />
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

function AnnotationLockedByUserTag({
  blockedByUser,
  activeUser,
}: {
  blockedByUser: APIUserCompact | null | undefined;
  activeUser: APIUser;
}) {
  let content;
  if (blockedByUser == null) {
    content = (
      <Tooltip title={messages["annotation.acquiringMutexFailed.noUser"]}>
        <Tag color="warning">Locked by unknown user.</Tag>
      </Tooltip>
    );
  } else if (blockedByUser.id === activeUser.id) {
    content = (
      <Tooltip title={messages["annotation.acquiringMutexSucceeded"]}>
        <Tag color="success">Locked by you. Reload to edit.</Tag>
      </Tooltip>
    );
  } else {
    const blockingUserName = `${blockedByUser.firstName} ${blockedByUser.lastName}`;
    content = (
      <Tooltip
        title={messages["annotation.acquiringMutexFailed"]({
          userName: blockingUserName,
        })}
      >
        <Tag color="warning">Locked by {blockingUserName}</Tag>
      </Tooltip>
    );
  }
  return (
    <span style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
      {content}
    </span>
  );
}

function Navbar({
  activeUser,
  isAuthenticated,
  isInAnnotationView,
  hasOrganizations,
  othersMayEdit,
  blockedByUser,
  allowUpdate,
}: Props) {
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
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);

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
  const menuItems: ItemType[] = [
    {
      key: "0",
      label: (
        <Link
          to="/dashboard"
          style={{
            fontWeight: 400,
            verticalAlign: "middle",
          }}
        >
          {getCollapsibleMenuTitle("WEBKNOSSOS", <span className="logo" />, collapseAllNavItems)}
        </Link>
      ),
    },
  ];
  const trailingNavItems = [];

  if (_isAuthenticated) {
    const loggedInUser: APIUser = activeUser;
    menuItems.push(getDashboardSubMenu(collapseAllNavItems));

    if (isAdminOrTeamManager && activeUser != null) {
      menuItems.push(
        getAdministrationSubMenu(collapseAllNavItems, isAdmin, activeUser.organization),
      );
      menuItems.push(getStatisticsSubMenu(collapseAllNavItems));
    } else {
      menuItems.push(getTimeTrackingMenu(collapseAllNavItems));
    }

    if (othersMayEdit && !allowUpdate) {
      trailingNavItems.push(
        <AnnotationLockedByUserTag
          key="locked-by-user-tag"
          blockedByUser={blockedByUser}
          activeUser={activeUser}
        />,
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
    getHelpSubMenu(
      version,
      polledVersion,
      _isAuthenticated,
      isAdminOrTeamManager,
      collapseAllNavItems,
      () => setIsHelpModalOpen(true),
    ),
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
        items={menuItems}
      />

      {isInAnnotationView ? separator : null}
      <HelpModal
        isModalOpen={isHelpModalOpen}
        onCancel={() => setIsHelpModalOpen(false)}
        centeredLayout
      />
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
  othersMayEdit: state.tracing.othersMayEdit,
  blockedByUser: state.tracing.blockedByUser,
  allowUpdate: state.tracing.restrictions.allowUpdate,
});

const connector = connect(mapStateToProps);
export default connector(Navbar);
