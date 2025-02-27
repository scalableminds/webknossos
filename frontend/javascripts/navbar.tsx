import {
  BarChartOutlined,
  BellOutlined,
  CheckOutlined,
  HomeOutlined,
  QuestionCircleOutlined,
  SwapOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  Avatar,
  Badge,
  Button,
  ConfigProvider,
  Input,
  type InputRef,
  Layout,
  Menu,
  Popover,
  type SubMenuProps,
  Tag,
  Tooltip,
} from "antd";
import classnames from "classnames";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { connect, useSelector } from "react-redux";
import { Link, useHistory } from "react-router-dom";

import {
  getBuildInfo,
  getUsersOrganizations,
  sendAnalyticsEvent,
  switchToOrganization,
  updateNovelUserExperienceInfos,
  updateSelectedThemeOfUser,
} from "admin/admin_rest_api";
import LoginForm from "admin/auth/login_form";
import { PricingPlanEnum } from "admin/organization/pricing_plan_utils";
import type { ItemType, MenuItemType, SubMenuType } from "antd/es/menu/interface";
import { MaintenanceBanner, UpgradeVersionBanner } from "banners";
import { PricingEnforcedSpan } from "components/pricing_enforcers";
import features from "features";
import { useFetch, useInterval } from "libs/react_helpers";
import Request from "libs/request";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import window, { location } from "libs/window";
import messages from "messages";
import constants from "oxalis/constants";
import {
  isAnnotationFromDifferentOrganization,
  isAnnotationOwner as isAnnotationOwnerAccessor,
} from "oxalis/model/accessors/annotation_accessor";
import { formatUserName } from "oxalis/model/accessors/user_accessor";
import { setThemeAction } from "oxalis/model/actions/ui_actions";
import { logoutUserAction, setActiveUserAction } from "oxalis/model/actions/user_actions";
import type { OxalisState } from "oxalis/store";
import Store from "oxalis/store";
import { HelpModal } from "oxalis/view/help_modal";
import { PortalTarget } from "oxalis/view/layouting/portal_utils";
import type { MenuClickEventHandler } from "rc-menu/lib/interface";
import { getAntdTheme, getSystemColorTheme } from "theme";
import type {
  APIOrganizationCompact,
  APIUser,
  APIUserCompact,
  APIUserTheme,
} from "types/api_flow_types";

const { Header } = Layout;

const HELP_MENU_KEY = "helpMenu";
// At most, 20 organizations are rendered in the dropdown.
const MAX_RENDERED_ORGANIZATION = 20;
// A search input is shown when more than 10 switchable organizations
// exist.
const ORGANIZATION_COUNT_THRESHOLD_FOR_SEARCH_INPUT = 10;

type OwnProps = {
  isAuthenticated: boolean;
};
type StateProps = {
  activeUser: APIUser | null | undefined;
  isInAnnotationView: boolean;
  hasOrganizations: boolean;
  othersMayEdit: boolean;
  allowUpdate: boolean;
  isLockedByOwner: boolean;
  isAnnotationFromDifferentOrganization: boolean;
  isAnnotationOwner: boolean;
  annotationOwnerName: string;
  blockedByUser: APIUserCompact | null | undefined;
  navbarHeight: number;
};
type Props = OwnProps & StateProps;
// The user should click somewhere else to close that menu like it's done in most OS menus, anyway. 10 seconds.
const subMenuCloseDelay = 10;

function useOlvy() {
  const [isInitialized, setIsInitialized] = useState(false);
  // Initialize Olvy after mounting
  useEffect(() => {
    const OlvyConfig = {
      organisation: "webknossos",
      // This target needs to be an empty string as else olvy will eagerly init the modal and thus fetch all its contents.
      target: "",
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

    if (window.Olvy != null) {
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
      if (!isInitialized || !window.Olvy) {
        return null;
      }

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

export function getAdministrationSubMenu(collapse: boolean, activeUser: APIUser) {
  const isAdmin = Utils.isUserAdmin(activeUser);
  const isAdminOrTeamManager = Utils.isUserAdminOrTeamManager(activeUser);
  const organization = activeUser.organization;

  const adminstrationSubMenuItems = isAdminOrTeamManager
    ? [
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
      ]
    : [];

  if (features().jobsEnabled)
    adminstrationSubMenuItems.push({
      key: "/jobs",
      label: <Link to="/jobs">Processing Jobs</Link>,
    });

  if (isAdmin) {
    adminstrationSubMenuItems.push({
      key: `/organizations/${organization}`,
      label: <Link to={`/organizations/${organization}`}>Organization</Link>,
    });
  }
  if (activeUser.isSuperUser) {
    adminstrationSubMenuItems.push({
      key: "/aiModels",
      label: <Link to={"/aiModels"}>AI Models</Link>,
    });
  }

  if (features().voxelyticsEnabled)
    adminstrationSubMenuItems.push({
      key: "/workflows",
      label: <Link to="/workflows">Voxelytics</Link>,
    });

  if (adminstrationSubMenuItems.length === 0) {
    return null;
  }

  return {
    key: "adminMenu",
    className: collapse ? "hide-on-small-screen" : "",
    label: getCollapsibleMenuTitle(
      "Administration",
      <TeamOutlined className="icon-margin-right" />,
      collapse,
    ),
    children: adminstrationSubMenuItems,
  };
}

function getStatisticsSubMenu(collapse: boolean): SubMenuType {
  return {
    key: "statisticMenu",
    className: collapse ? "hide-on-small-screen" : "",
    label: getCollapsibleMenuTitle(
      "Statistics",
      <BarChartOutlined className="icon-margin-right" />,
      collapse,
    ),
    children: [
      {
        key: "/timetracking",
        label: (
          <PricingEnforcedSpan requiredPricingPlan={PricingPlanEnum.Team}>
            <Link to="/timetracking">Time Tracking</Link>
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
        key: "/reports/availableTasks",
        label: (
          <PricingEnforcedSpan requiredPricingPlan={PricingPlanEnum.Team}>
            <Link to="/reports/availableTasks">Available Task Assignments</Link>
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
        to="/timetracking"
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
  isAdminOrManager: boolean,
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
    (!features().discussionBoardRequiresAdmin || isAdminOrManager) &&
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
          href="https://docs.webknossos.org/webknossos/ui/keyboard_shortcuts.html"
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

  if (features().isWkorgInstance) {
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
    label: getCollapsibleMenuTitle(
      "Help",
      <QuestionCircleOutlined className="icon-margin-right" />,
      collapse,
    ),
    children: helpSubMenuItems,
  };
}

function getDashboardSubMenu(collapse: boolean): SubMenuType {
  return {
    key: "dashboardMenu",
    className: collapse ? "hide-on-small-screen" : "",
    label: getCollapsibleMenuTitle(
      "Dashboard",
      <HomeOutlined className="icon-margin-right" />,
      collapse,
    ),
    children: [
      { key: "/dashboard/datasets", label: <Link to="/dashboard/datasets">Datasets</Link> },
      {
        key: "/dashboard/annotations",
        label: <Link to="/dashboard/annotations">Annotations</Link>,
      },
      { key: "/dashboard/tasks", label: <Link to="/dashboard/tasks">Tasks</Link> },
    ],
  };
}

function NotificationIcon({
  activeUser,
  navbarHeight,
}: {
  activeUser: APIUser;
  navbarHeight: number;
}) {
  const maybeUnreadReleaseCount = useOlvyUnreadReleasesCount(activeUser);

  const handleShowWhatsNewView = () => {
    const [newUserSync] = updateNovelUserExperienceInfos(activeUser, {
      lastViewedWhatsNewTimestamp: new Date().getTime(),
    });
    Store.dispatch(setActiveUserAction(newUserSync));
    sendAnalyticsEvent("open_whats_new_view");

    if (window.Olvy) {
      // Setting the target lazily, to finally let olvy load the “what’s new” modal, as it should be shown now.
      window.Olvy.config.target = "#unused-olvy-target";
      window.Olvy.show();
    }
  };

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        marginRight: 12,
        paddingTop: navbarHeight > constants.DEFAULT_NAVBAR_HEIGHT ? constants.BANNER_HEIGHT : 0,
      }}
    >
      <Tooltip title="See what's new in WEBKNOSSOS" placement="bottomLeft">
        <Badge count={maybeUnreadReleaseCount || 0} size="small">
          <Button onClick={handleShowWhatsNewView} shape="circle" icon={<BellOutlined />} />
        </Badge>
      </Tooltip>
    </div>
  );
}

export const switchTo = async (org: APIOrganizationCompact) => {
  Toast.info(`Switching to ${org.name || org.id}`);

  // If the user is currently at the datasets tab, the active folder is encoded
  // in the URI. Switching to another organization means that the folder id
  // becomes invalid. That's why, we are removing any identifiers from the
  // current datasets path before reloading the page (which is done in
  // switchToOrganization).
  if (window.location.pathname.startsWith("/dashboard/datasets/")) {
    window.history.replaceState({}, "", "/dashboard/datasets/");
  }

  await switchToOrganization(org.id);
};

function OrganizationFilterInput({
  onChange,
  isVisible,
  onPressEnter,
}: { onChange: (val: string) => void; isVisible: boolean; onPressEnter: () => void }) {
  const ref = useRef<InputRef>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Biome doesn't understand that ref.current is accessed?
  useEffect(() => {
    if (ref?.current && isVisible) {
      setTimeout(() => {
        // Without the timeout, the focus doesn't work unfortunately.
        ref.current?.input?.focus();
      }, 100);
    }
  }, [ref.current, isVisible]);
  const onChangeImpl = (evt: React.ChangeEvent<HTMLInputElement>) => {
    onChange(evt.target.value);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const consumableKeyCodes = [40, 38, 27]; // up, down, escape
    if (!consumableKeyCodes.includes(event.keyCode)) {
      event.stopPropagation();
    }
  };

  return (
    <Input
      placeholder="Filter organizations..."
      onChange={onChangeImpl}
      onKeyDown={onKeyDown}
      ref={ref}
      onPressEnter={onPressEnter}
    />
  );
}

function LoggedInAvatar({
  activeUser,
  handleLogout,
  navbarHeight,
}: {
  activeUser: APIUser;
  handleLogout: (event: React.SyntheticEvent) => void;
  navbarHeight: number;
} & SubMenuProps) {
  const { firstName, lastName, organization: organizationId, selectedTheme } = activeUser;
  const usersOrganizations = useFetch(getUsersOrganizations, [], []);
  const activeOrganization = usersOrganizations.find((org) => org.id === organizationId);
  const switchableOrganizations = usersOrganizations.filter((org) => org.id !== organizationId);
  const orgName =
    activeOrganization != null ? activeOrganization.name || activeOrganization.id : organizationId;
  const [organizationFilter, onChangeOrganizationFilter] = useState("");
  const [openKeys, setOpenKeys] = useState<string[]>([]);

  const filteredOrganizations = Utils.filterWithSearchQueryAND(
    switchableOrganizations,
    ["name", "id"],
    organizationFilter,
  );
  const onEnterOrganization = () => {
    if (filteredOrganizations.length > 0) {
      switchTo(filteredOrganizations[0]);
    }
  };

  const setSelectedTheme = async (newTheme: APIUserTheme) => {
    if (newTheme === "auto") newTheme = getSystemColorTheme();

    if (selectedTheme !== newTheme) {
      const newUser = await updateSelectedThemeOfUser(activeUser.id, newTheme);
      Store.dispatch(setThemeAction(newTheme));
      Store.dispatch(setActiveUserAction(newUser));
    }
  };

  const maybeOrganizationFilterInput =
    switchableOrganizations.length > ORGANIZATION_COUNT_THRESHOLD_FOR_SEARCH_INPUT
      ? [
          {
            key: "input",
            label: (
              <OrganizationFilterInput
                onChange={onChangeOrganizationFilter}
                isVisible={openKeys.includes("switch-organization")}
                onPressEnter={onEnterOrganization}
              />
            ),
          },
        ]
      : [];

  const isMultiMember = switchableOrganizations.length > 0;
  return (
    <Menu
      selectedKeys={["prevent highlighting of this menu"]}
      mode="horizontal"
      style={{
        paddingTop: navbarHeight > constants.DEFAULT_NAVBAR_HEIGHT ? constants.BANNER_HEIGHT : 0,
        lineHeight: `${constants.DEFAULT_NAVBAR_HEIGHT}px`,
      }}
      theme="dark"
      subMenuCloseDelay={subMenuCloseDelay}
      triggerSubMenuAction="click"
      className="right-navbar"
      onOpenChange={setOpenKeys}
      openKeys={openKeys}
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
              label: orgName,
              disabled: true,
            },
            activeOrganization && Utils.isUserAdmin(activeUser)
              ? {
                  key: "manage-organization",
                  label: (
                    <Link to={`/organizations/${activeOrganization.id}`}>Manage Organization</Link>
                  ),
                }
              : null,
            isMultiMember
              ? {
                  key: "switch-organization",
                  label: "Switch Organization",
                  popupClassName: "organization-switch-menu",
                  children: [
                    ...maybeOrganizationFilterInput,
                    ...filteredOrganizations.slice(0, MAX_RENDERED_ORGANIZATION).map((org) => ({
                      key: org.id,
                      onClick: () => switchTo(org),
                      label: org.name || org.id,
                    })),
                  ],
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
  const bannerHeight = useSelector(
    (state: OxalisState) => state.uiInformation.navbarHeight - constants.DEFAULT_NAVBAR_HEIGHT,
  );
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
          marginTop: bannerHeight,
        }}
      />
    </Popover>
  );
}

async function getVersion() {
  const buildInfo = await getBuildInfo();
  return buildInfo.webknossos.version;
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
        <Tag color="warning" className="flex-center-child">
          Locked by unknown user.
        </Tag>
      </Tooltip>
    );
  } else if (blockedByUser.id === activeUser.id) {
    content = (
      <Tooltip title={messages["annotation.acquiringMutexSucceeded"]}>
        <Tag color="success" className="flex-center-child">
          Locked by you. Reload to edit.
        </Tag>
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
        <Tag color="warning" className="flex-center-child">
          Locked by {blockingUserName}
        </Tag>
      </Tooltip>
    );
  }
  return (
    <span style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
      {content}
    </span>
  );
}

function AnnotationLockedByOwnerTag(props: { annotationOwnerName: string; isOwner: boolean }) {
  const unlockHintForOwners = props.isOwner
    ? " You can unlock the annotation in the navbar annotation menu."
    : "";
  const tooltipMessage =
    messages["tracing.read_only_mode_notification"](true, props.isOwner) + unlockHintForOwners;
  return (
    <Tooltip title={tooltipMessage}>
      <Tag color="warning" className="flex-center-child">
        Locked by {props.annotationOwnerName}
      </Tag>
    </Tooltip>
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
  annotationOwnerName,
  isLockedByOwner,
  isAnnotationFromDifferentOrganization,
  navbarHeight,
  isAnnotationOwner,
}: Props) {
  const history = useHistory();

  const handleLogout = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    await Request.receiveJSON("/api/auth/logout");
    Store.dispatch(logoutUserAction());
    // Hard navigation
    location.href = "/";
  };

  const version = useFetch(getVersion, null, []);
  const [isHelpMenuOpen, setIsHelpMenuOpen] = useState(false);
  const [polledVersion, setPolledVersion] = useState<string | null>(null);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);

  useInterval(
    async () => {
      if (isHelpMenuOpen) {
        setPolledVersion(await getVersion());
      }
    },
    2000,
    isHelpMenuOpen,
  );

  const _isAuthenticated = isAuthenticated && activeUser != null;

  const isAdminOrManager = activeUser != null ? Utils.isUserAdminOrManager(activeUser) : false;
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

    if (isAdminOrManager && activeUser != null) {
      menuItems.push(getAdministrationSubMenu(collapseAllNavItems, activeUser));
      if (Utils.isUserAdminOrTeamManager(activeUser)) {
        menuItems.push(getStatisticsSubMenu(collapseAllNavItems));
      }
    } else {
      menuItems.push(getTimeTrackingMenu(collapseAllNavItems));
    }

    if (
      othersMayEdit &&
      !allowUpdate &&
      !isLockedByOwner &&
      !isAnnotationFromDifferentOrganization
    ) {
      trailingNavItems.push(
        <AnnotationLockedByUserTag
          key="locked-by-user-tag"
          blockedByUser={blockedByUser}
          activeUser={activeUser}
        />,
      );
    }
    if (isLockedByOwner) {
      trailingNavItems.push(
        <AnnotationLockedByOwnerTag
          key="locked-by-owner-tag"
          annotationOwnerName={annotationOwnerName}
          isOwner={isAnnotationOwner}
        />,
      );
    }
    trailingNavItems.push(
      <NotificationIcon
        key="notification-icon"
        activeUser={loggedInUser}
        navbarHeight={navbarHeight}
      />,
    );
    trailingNavItems.push(
      <LoggedInAvatar
        key="logged-in-avatar"
        activeUser={loggedInUser}
        handleLogout={handleLogout}
        navbarHeight={navbarHeight}
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
      isAdminOrManager,
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
      className={classnames("navbar-header", {
        "collapsed-nav-header": collapseAllNavItems,
      })}
    >
      <GlobalProgressBar />
      <MaintenanceBanner />
      <ConfigProvider theme={{ ...getAntdTheme("light") }}>
        <UpgradeVersionBanner />
      </ConfigProvider>
      <Menu
        mode="horizontal"
        selectedKeys={selectedKeys}
        onOpenChange={(openKeys) => setIsHelpMenuOpen(openKeys.includes(HELP_MENU_KEY))}
        style={{
          paddingTop: navbarHeight > constants.DEFAULT_NAVBAR_HEIGHT ? constants.BANNER_HEIGHT : 0,
          lineHeight: `${constants.DEFAULT_NAVBAR_HEIGHT}px`,
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
          paddingTop: navbarHeight > constants.DEFAULT_NAVBAR_HEIGHT ? constants.BANNER_HEIGHT : 0,
        }}
      />
      <ConfigProvider theme={{ ...getAntdTheme("dark") }}>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginRight: 12,
          }}
        >
          {trailingNavItems}
        </div>
      </ConfigProvider>
    </Header>
  );
}

function GlobalProgressBar() {
  const globalProgress = useSelector((state: OxalisState) => state.uiInformation.globalProgress);
  const hide = globalProgress === 0;
  return (
    <div
      className={`global-progress-bar ${hide ? "hidden-global-progress-bar" : ""}`}
      style={{ width: `${Math.round(globalProgress * 100)}%` }}
    />
  );
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
  isInAnnotationView: state.uiInformation.isInAnnotationView,
  hasOrganizations: state.uiInformation.hasOrganizations,
  othersMayEdit: state.tracing.othersMayEdit,
  blockedByUser: state.tracing.blockedByUser,
  allowUpdate: state.tracing.restrictions.allowUpdate,
  isLockedByOwner: state.tracing.isLockedByOwner,
  annotationOwnerName: formatUserName(state.activeUser, state.tracing.owner),
  isAnnotationOwner: isAnnotationOwnerAccessor(state),
  isAnnotationFromDifferentOrganization: isAnnotationFromDifferentOrganization(state),
  navbarHeight: state.uiInformation.navbarHeight,
});

const connector = connect(mapStateToProps);
export default connector(Navbar);
