import Icon, {
  BarChartOutlined,
  ExperimentOutlined,
  HomeOutlined,
  LoadingOutlined,
  MessageOutlined,
  QuestionCircleOutlined,
  ScheduleOutlined,
  SwapOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import WkLogoIcon from "@images/wk-logo.svg?react";
import { getUsersOrganizations, switchToOrganization } from "admin/api/organization";
import LoginForm from "admin/auth/login_form";
import { useLogout } from "admin/auth/use_logout";
import {
  areJobsAllowedByPricingPlan,
  PricingPlanEnum,
} from "admin/organization/pricing_plan_utils";
import { getBuildInfo, sendAnalyticsEvent, updateNovelUserExperienceInfos } from "admin/rest_api";
import type { MenuProps } from "antd";
import {
  Avatar,
  Badge,
  Button,
  ConfigProvider,
  Flex,
  Input,
  type InputRef,
  Layout,
  Menu,
  Popover,
  Spin,
  type SubMenuProps,
  Tag,
  Tooltip,
} from "antd";
import type { ItemType, MenuItemType, SubMenuType } from "antd/es/menu/interface";
import { MaintenanceBanner, UpgradeVersionBanner } from "banners";
import classnames from "classnames";
import { PartnerLogo } from "components/partner_logo";
import { PricingEnforcedSpan } from "components/pricing_enforcers";
import { WhatsNewModal } from "components/whats_new_modal";
import features from "features";
import { useFetch, useInterval } from "libs/react_helpers";
import { useMinScreenWidth, useWkSelector } from "libs/react_hooks";
import {
  getNewestReleaseNoteId,
  getUnreadReleaseNotesCount,
  type ReleaseNotesReadState,
} from "libs/release_notes";
import { TAB_SESSION_ID as SESSION_ID } from "libs/tab_session_id";
import Toast from "libs/toast";
import {
  filterWithSearchQueryAND,
  isUserAdmin,
  isUserAdminOrDatasetManager,
  isUserAdminOrManager,
  isUserAdminOrTeamManager,
} from "libs/utils";
import window, { location } from "libs/window";
import messages from "messages";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { Link, useLocation } from "react-router";
import { getAntdTheme } from "theme";
import type {
  APIOrganization,
  APIOrganizationCompact,
  APIUser,
  APIUserCompact,
} from "types/api_types";
import constants from "viewer/constants";
import {
  isAnnotationEditableByNonOwners,
  isAnnotationFromDifferentOrganization as isAnnotationFromDifferentOrganizationAccessor,
  isAnnotationOwner as isAnnotationOwnerAccessor,
  mayEditAnnotation,
} from "viewer/model/accessors/annotation_accessor";
import { formatUserName } from "viewer/model/accessors/user_accessor";
import { retryMutexAcquisitionNowAction } from "viewer/model/actions/save_actions";
import { setActiveUserAction } from "viewer/model/actions/user_actions";
import { Store } from "viewer/singletons";
import { HelpModal } from "viewer/view/help/help_modal";
import { LandmarkPanelToggleButton } from "viewer/view/layer_registration/landmark_panel_toggle_button";
import {
  isLayerRegistrationPrimaryWorker,
  isLayerRegistrationWorker,
} from "viewer/view/layer_registration/layer_registration_protocol";
import { PortalTarget } from "viewer/view/layouting/portal_utils";

const { Header } = Layout;

const HELP_MENU_KEY = "helpMenu";
// At most, 20 organizations are rendered in the dropdown.
const MAX_RENDERED_ORGANIZATION = 20;
// A search input is shown when more than 10 switchable organizations
// exist.
const ORGANIZATION_COUNT_THRESHOLD_FOR_SEARCH_INPUT = 10;

// The user should click somewhere else to close that menu like it's done in most OS menus, anyway. 10 seconds.
const subMenuCloseDelay = 10;

function getReleaseNotesReadState(activeUser: APIUser): ReleaseNotesReadState {
  const { newestSeenReleaseNoteId, lastViewedWhatsNewTimestamp } =
    activeUser.novelUserExperienceInfos;
  return {
    newestSeenReleaseNoteId: newestSeenReleaseNoteId ?? null,
    lastViewedTimestamp: lastViewedWhatsNewTimestamp ?? activeUser.created,
  };
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
    <div>
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
  const isAdmin = isUserAdmin(activeUser);
  const isAdminOrTeamManager = isUserAdminOrTeamManager(activeUser);
  const organization = activeUser.organization;

  const adminstrationSubMenuItems = isAdminOrTeamManager
    ? [
        { key: "/users", label: <Link to="/users">Users</Link> },
        { key: "/teams", label: <Link to="/teams">Teams</Link> },
      ]
    : [];

  if (isAdmin) {
    adminstrationSubMenuItems.push({
      key: `/organizations/${organization}`,
      label: <Link to={`/organizations/${organization}`}>Organization</Link>,
    });
  }

  if (adminstrationSubMenuItems.length === 0) {
    return null;
  }

  return {
    key: "adminMenu",
    label: getCollapsibleMenuTitle(
      "Administration",
      <TeamOutlined className="icon-margin-right" />,
      collapse,
    ),
    children: adminstrationSubMenuItems,
  };
}

export function getAnalysisSubMenu(
  collapse: boolean,
  activeUser: APIUser | null | undefined,
  activeOrganization: APIOrganization | null,
) {
  const analysisSubMenuItems = [];

  if (features().jobsEnabled && areJobsAllowedByPricingPlan(activeOrganization)) {
    analysisSubMenuItems.push({
      key: "/jobs",
      label: <Link to="/jobs">Processing Jobs</Link>,
    });
    analysisSubMenuItems.push({
      key: "/aiModels",
      label: <Link to={"/aiModels"}>AI Models</Link>,
    });
    if (isUserAdminOrDatasetManager(activeUser)) {
      analysisSubMenuItems.push({
        key: "/alignmentProjects",
        label: <Link to="/alignmentProjects">Alignment Projects</Link>,
      });
    }
  }

  if (features().voxelyticsEnabled) {
    analysisSubMenuItems.push({
      key: "/workflows",
      label: <Link to="/workflows">Voxelytics</Link>,
    });
  }

  if (analysisSubMenuItems.length === 0) {
    return null;
  }

  return {
    key: "analysisMenu",
    label: getCollapsibleMenuTitle(
      "Analysis",
      <ExperimentOutlined className="icon-margin-right" />,
      collapse,
    ),
    children: analysisSubMenuItems,
  };
}

function getTaskManagementSubMenu(collapse: boolean): SubMenuType {
  return {
    key: "taskManagementMenu",
    label: getCollapsibleMenuTitle(
      "Task Management",
      <ScheduleOutlined className="icon-margin-right" />,
      collapse,
    ),
    children: [
      {
        key: "/projects",
        label: (
          <PricingEnforcedSpan requiredPricingPlan={PricingPlanEnum.Team}>
            <Link to="/projects">Annotation Projects</Link>
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
      { type: "divider" },
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
      {
        key: "/timetracking",
        label: (
          <PricingEnforcedSpan requiredPricingPlan={PricingPlanEnum.Team}>
            <Link to="/timetracking">Time Tracking</Link>
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
      <PricingEnforcedSpan requiredPricingPlan={PricingPlanEnum.Team}>
        <Link to="/timetracking">
          {getCollapsibleMenuTitle(
            "Time Tracking",
            <BarChartOutlined className="icon-margin-right" />,
            collapse,
          )}
        </Link>
      </PricingEnforcedSpan>
    ),
  };
}

function getHelpSubMenu(
  version: string | null,
  polledVersion: string | null,
  isAuthenticated: boolean,
  isAdminOrManager: boolean,
  collapse: boolean,
  openHelpModal: MenuProps["onClick"],
) {
  const polledVersionString =
    polledVersion != null && polledVersion !== version
      ? `(Server is currently at ${polledVersion}!)`
      : "";

  const { discussionBoardRequiresAdmin, discussionBoard, isWkorgInstance } = features();

  const helpSubMenuItems: ItemType[] = [
    {
      key: "user-documentation",
      label: (
        <a target="_blank" href="https://docs.webknossos.org" rel="noreferrer noopener">
          User Documentation
        </a>
      ),
    },
    (!discussionBoardRequiresAdmin || isAdminOrManager) && discussionBoard !== false
      ? {
          key: "discussion-board",
          label: (
            <a href={discussionBoard} target="_blank" rel="noreferrer noopener">
              Community Support
            </a>
          ),
        }
      : null,
    {
      key: "frontend-api",
      label: (
        <a
          target="_blank"
          href="https://docs.webknossos.org/frontend-api/index.html"
          rel="noopener noreferrer"
        >
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

  if (isWkorgInstance) {
    helpSubMenuItems.push({
      key: "contact",
      label: (
        <a target="_blank" href="mailto:support@webknossos.org" rel="noopener noreferrer">
          Email Us
        </a>
      ),
    });
  } else {
    helpSubMenuItems.push({
      key: "credits",
      label: (
        <a target="_blank" href="https://home.webknossos.org/about-us" rel="noopener noreferrer">
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
    className: "hide-on-small-screen",
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

function getWhatsNewMenuEntry(unreadReleaseNotesCount: number, onClick: () => void) {
  return {
    key: "whatsNew",
    label: (
      <Badge
        className="navbar-whats-new-badge"
        count={unreadReleaseNotesCount}
        size="small"
        offset={[10, 0]}
      >
        What's new
      </Badge>
    ),
    onClick,
  };
}

export const switchTo = async (org: APIOrganizationCompact) => {
  Toast.info(`Switching to ${org.name || org.id}`);

  // If the user is currently at the datasets tab, the active folder is encoded
  // in the URI. Switching to another organization means that the folder id
  // becomes invalid. That's why, we are removing any identifiers from the
  // current datasets path before reloading the page (which is done in
  // switchToOrganization).
  if (window.location.pathname.startsWith("/dashboard/datasets/")) {
    window.history.replaceState(window.history.state, "", "/dashboard/datasets/");
  }

  await switchToOrganization(org.id);
};

function OrganizationFilterInput({
  onChange,
  isVisible,
  onPressEnter,
}: {
  onChange: (val: string) => void;
  isVisible: boolean;
  onPressEnter: () => void;
}) {
  const ref = useRef<InputRef>(null);

  useEffect(() => {
    if (ref.current && isVisible) {
      setTimeout(() => {
        // Without the timeout, the focus doesn't work unfortunately.
        ref.current?.input?.focus();
      }, 100);
    }
  }, [isVisible]);
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
}: {
  activeUser: APIUser;
  handleLogout: (event: React.SyntheticEvent) => void;
} & SubMenuProps) {
  const { firstName, lastName, organization: organizationId } = activeUser;
  const usersOrganizations = useFetch(getUsersOrganizations, [], []);
  const activeOrganization = usersOrganizations.find((org) => org.id === organizationId);
  const switchableOrganizations = usersOrganizations.filter((org) => org.id !== organizationId);
  const orgName =
    activeOrganization != null ? activeOrganization.name || activeOrganization.id : organizationId;
  const [organizationFilter, onChangeOrganizationFilter] = useState("");
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const releaseNotesReadState = getReleaseNotesReadState(activeUser);
  const unreadReleaseNotesCount = getUnreadReleaseNotesCount(releaseNotesReadState);
  const [isWhatsNewModalOpen, setIsWhatsNewModalOpen] = useState(false);
  // Remember which release notes were unread when the modal was opened, as opening it marks
  // all of them as read.
  const [whatsNewModalReadState, setWhatsNewModalReadState] = useState(releaseNotesReadState);
  const showWhatsNewModal = () => {
    setWhatsNewModalReadState(releaseNotesReadState);
    setIsWhatsNewModalOpen(true);
    sendAnalyticsEvent("open_whats_new_view");
  };
  // Only mark the release notes as seen once they could be loaded and are shown.
  const markReleaseNotesAsSeen = () => {
    const [newUserSync] = updateNovelUserExperienceInfos(activeUser, {
      lastViewedWhatsNewTimestamp: Date.now(),
      newestSeenReleaseNoteId:
        getNewestReleaseNoteId() ?? releaseNotesReadState.newestSeenReleaseNoteId ?? undefined,
    });
    Store.dispatch(setActiveUserAction(newUserSync));
  };

  const filteredOrganizations = filterWithSearchQueryAND(
    switchableOrganizations,
    ["name", "id"],
    organizationFilter,
  );
  const onEnterOrganization = () => {
    if (filteredOrganizations.length > 0) {
      switchTo(filteredOrganizations[0]);
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
    <>
      <Menu
        selectedKeys={["prevent highlighting of this menu"]}
        mode="horizontal"
        style={{
          lineHeight: `${constants.DEFAULT_NAVBAR_HEIGHT}px`,
          marginInlineStart: "10px",
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
              { type: "divider" },
              getWhatsNewMenuEntry(unreadReleaseNotesCount, showWhatsNewModal),
              {
                key: "account",
                label: <Link to="/account">Account Settings</Link>,
              },
              activeOrganization && isUserAdmin(activeUser)
                ? {
                    key: "manage-organization",
                    label: <Link to={"/organization/overview"}>Organization Settings</Link>,
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
      <WhatsNewModal
        isOpen={isWhatsNewModalOpen}
        onClose={() => setIsWhatsNewModalOpen(false)}
        readState={whatsNewModalReadState}
        onLoaded={markReleaseNotesAsSeen}
      />
    </>
  );
}

function AnonymousAvatar() {
  const bannerHeight = useWkSelector(
    (state) => state.uiInformation.navbarHeight - constants.DEFAULT_NAVBAR_HEIGHT,
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
  blockedBySessionId,
  activeUser,
}: {
  blockedByUser: APIUserCompact | null | undefined;
  blockedBySessionId: string | null | undefined;
  activeUser: APIUser;
}) {
  const dispatch = useDispatch();
  const [isRetrying, setIsRetrying] = useState(false);

  const handleOnClick = () => {
    if (blockedByUser == null) {
      location.reload();
    } else {
      dispatch(retryMutexAcquisitionNowAction());
      setIsRetrying(true);
      setTimeout(() => setIsRetrying(false), 1000);
    }
  };

  const retryTooltipSuffix = " Click to retry acquiring the lock immediately.";
  let tooltipTitle: string;
  let tagLabel: React.ReactNode;

  if (blockedByUser == null) {
    tooltipTitle = messages["annotation.reloadToEditWithMutex"];
    tagLabel = "Please reload the page.";
  } else if (blockedByUser.id === activeUser.id && blockedBySessionId === SESSION_ID) {
    tooltipTitle = messages["annotation.acquiringMutexSucceeded"];
    tagLabel = "Locked by you. Reload to edit.";
    return (
      <Tooltip title={tooltipTitle}>
        <Tag color="success" variant="outlined">
          {tagLabel}
        </Tag>
      </Tooltip>
    );
  } else if (blockedByUser.id === activeUser.id) {
    tooltipTitle =
      messages["annotation.acquiringMutexFailed.sameUserDifferentSession"] + retryTooltipSuffix;
    tagLabel = "Locked by you in another tab.";
  } else {
    const blockingUserName = `${blockedByUser.firstName} ${blockedByUser.lastName}`;
    tooltipTitle =
      messages["annotation.acquiringMutexFailed"]({ userName: blockingUserName }) +
      retryTooltipSuffix;
    tagLabel = `Locked by ${blockingUserName}`;
  }

  return (
    <Tooltip title={tooltipTitle}>
      <Tag color="warning" variant="outlined" style={{ cursor: "pointer" }} onClick={handleOnClick}>
        {isRetrying ? (
          <Spin
            indicator={
              <LoadingOutlined spin style={{ color: "var(--ant-color-warning)", marginRight: 4 }} />
            }
            size="small"
          />
        ) : null}
        {tagLabel}
      </Tag>
    </Tooltip>
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
      <Tag color="warning" variant="outlined">
        Locked by {props.annotationOwnerName}
      </Tag>
    </Tooltip>
  );
}

function AnnotationLockedTag(): React.ReactElement | null {
  const isSavingDisabled = useWkSelector((state) => state.save.isSavingDisabled);
  const othersMayEdit = useWkSelector((state) => isAnnotationEditableByNonOwners(state.annotation));
  const allowUpdate = useWkSelector(mayEditAnnotation);
  const isLockedByOwner = useWkSelector((state) => state.annotation.isLockedByOwner);
  const isAnnotationFromDifferentOrganization = useWkSelector((state) =>
    isAnnotationFromDifferentOrganizationAccessor(state),
  );
  const blockedByUser = useWkSelector((state) => state.save.mutexState.blockedByUser);
  const blockedBySessionId = useWkSelector((state) => state.save.mutexState.blockedBySessionId);
  const activeUser = useWkSelector((state) => state.activeUser);
  const annotationOwnerName = useWkSelector((state) =>
    formatUserName(state.activeUser, state.annotation.owner),
  );
  const isAnnotationOwner = useWkSelector((state) => isAnnotationOwnerAccessor(state));

  if (isSavingDisabled || activeUser == null) return null;

  if (othersMayEdit && !allowUpdate && !isLockedByOwner && !isAnnotationFromDifferentOrganization) {
    return (
      <AnnotationLockedByUserTag
        key="locked-by-user-tag"
        blockedByUser={blockedByUser}
        blockedBySessionId={blockedBySessionId}
        activeUser={activeUser}
      />
    );
  } else if (isLockedByOwner) {
    return (
      <AnnotationLockedByOwnerTag
        key="locked-by-owner-tag"
        annotationOwnerName={annotationOwnerName}
        isOwner={isAnnotationOwner}
      />
    );
  }
  return null;
}

// In the annotation view and on phones, the nav items are shown as icons only.
function useCollapseAllNavItems(): boolean {
  const isInAnnotationView = useWkSelector((state) => state.uiInformation.isInAnnotationView);
  const isPhone = !useMinScreenWidth("md");
  return isInAnnotationView || isPhone;
}

// The WEBKNOSSOS logo, which links to the dashboard.
function getLogoMenuItem(collapse: boolean, linkTarget?: "_top"): MenuItemType {
  return {
    key: "0",
    label: (
      <>
        <Link
          to="/dashboard"
          target={linkTarget}
          aria-label="WEBKNOSSOS"
          style={{
            verticalAlign: "middle",
          }}
        >
          {collapse ? (
            getCollapsibleMenuTitle(
              "WEBKNOSSOS",
              <Icon component={WkLogoIcon} className="logo icon-margin-right" />,
              true,
            )
          ) : (
            <>
              <Icon component={WkLogoIcon} className="logo" />
              <span className="logo-wordmark">WEBKNOSSOS</span>
            </>
          )}
        </Link>
        <PartnerLogo compact={collapse} />
      </>
    ),
  };
}

type NavbarFrameProps = {
  menuItems: ItemType[];
  trailingNavItems: React.ReactNode[];
  menuProps?: Pick<MenuProps, "selectedKeys" | "onOpenChange">;
  // Rendered next to the menu, e.g. modals that the menu opens.
  children?: React.ReactNode;
};

// The parts that all navbars share: the banners, the menu, the slot for the viewer's action bar
// and the items at the right end.
function NavbarFrame({ menuItems, trailingNavItems, menuProps, children }: NavbarFrameProps) {
  const isInAnnotationView = useWkSelector((state) => state.uiInformation.isInAnnotationView);
  const navbarHeight = useWkSelector((state) => state.uiInformation.navbarHeight);
  const hasSaveError = useWkSelector((state) => state.save.hasSaveError);
  const collapseAllNavItems = useCollapseAllNavItems();
  // Pushes the navbar items below the maintenance/upgrade banner when one is shown.
  const bannerOffset = navbarHeight > constants.DEFAULT_NAVBAR_HEIGHT ? constants.BANNER_HEIGHT : 0;
  // Hidden together with the submenus it separates from the viewer's action bar.
  const separator = <div className="navbar-separator hide-on-narrow-screen" />;
  const showSeparator = isInAnnotationView && menuItems.length > 0;

  return (
    <Header
      className={classnames("navbar-header", {
        "collapsed-nav-header": collapseAllNavItems,
        "save-error": hasSaveError,
      })}
    >
      <GlobalProgressBar />
      <MaintenanceBanner />
      <ConfigProvider theme={getAntdTheme("light")}>
        <UpgradeVersionBanner />
      </ConfigProvider>
      <Menu
        mode="horizontal"
        {...menuProps}
        style={{
          paddingTop: bannerOffset,
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
      {showSeparator ? separator : null}
      {children}
      <PortalTarget
        portalId="navbarTracingSlot"
        style={{
          flex: 1,
          display: "flex",
          paddingTop: bannerOffset,
        }}
      />
      <ConfigProvider theme={getAntdTheme("dark")}>
        <Flex
          align="center"
          justify="flex-end"
          gap="small"
          // Keeps a gap to the menu or the viewer's action bar when the navbar gets crowded.
          style={{ paddingTop: bannerOffset, marginInlineStart: 8 }}
        >
          {trailingNavItems}
        </Flex>
      </ConfigProvider>
    </Header>
  );
}

// The layer registration page has no navbar, so the navbars of its workers only hold the toolbar
// of the worker, plus the link to the dashboard (left worker) or the toggle of the landmark panel,
// which is right of the right worker.
function LayerRegistrationWorkerNavbar() {
  const collapseAllNavItems = useCollapseAllNavItems();
  if (isLayerRegistrationPrimaryWorker()) {
    // A worker is an iframe of the layer registration page, so the dashboard replaces the whole
    // page.
    return (
      <NavbarFrame
        menuItems={[getLogoMenuItem(collapseAllNavItems, "_top")]}
        trailingNavItems={[]}
      />
    );
  }
  return (
    <NavbarFrame
      menuItems={[]}
      trailingNavItems={[<LandmarkPanelToggleButton key="landmark-panel-toggle" />]}
    />
  );
}

function DefaultNavbar() {
  const activeUser = useWkSelector((state) => state.activeUser);
  const activeOrganization = useWkSelector((state) => state.activeOrganization);
  const isInAnnotationView = useWkSelector((state) => state.uiInformation.isInAnnotationView);
  const hasOrganizations = useWkSelector((state) => state.uiInformation.hasOrganizations);
  const historyLocation = useLocation();

  const logout = useLogout();
  const handleLogout = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    await logout({ everywhere: false });
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

  const isAuthenticated = activeUser != null;
  const isAdminOrTeamManager = isUserAdminOrTeamManager(activeUser);
  const isAdminOrManager = isUserAdminOrManager(activeUser);
  // Phones get the icon-only navbar, too.
  const isPhone = !useMinScreenWidth("md");
  const isBelowXL = !useMinScreenWidth("xl");
  const collapseAllNavItems = useCollapseAllNavItems();
  const hideNavbarLogin = features().hideNavbarLogin || !hasOrganizations;
  const menuItems: ItemType[] = [getLogoMenuItem(collapseAllNavItems)];
  const trailingNavItems = [];

  // In the annotation view, the navbar also hosts the viewer's action bar, so the nav items give up
  // their space on narrower screens. On phones (outside the annotation view) they stay as icons.
  const hideInAnnotationViewOnNarrowScreens = <T extends SubMenuType | MenuItemType | null>(
    item: T,
  ): T =>
    item != null && isInAnnotationView
      ? { ...item, className: classnames(item.className, "hide-on-narrow-screen") }
      : item;

  if (isAuthenticated) {
    const loggedInUser: APIUser = activeUser;
    menuItems.push(hideInAnnotationViewOnNarrowScreens(getDashboardSubMenu(collapseAllNavItems)));
    menuItems.push(
      hideInAnnotationViewOnNarrowScreens(
        getAnalysisSubMenu(collapseAllNavItems, activeUser, activeOrganization),
      ),
    );

    if (isUserAdminOrTeamManager(activeUser)) {
      menuItems.push(
        hideInAnnotationViewOnNarrowScreens(getTaskManagementSubMenu(collapseAllNavItems)),
      );
    }

    if (isAdminOrTeamManager && activeUser != null) {
      menuItems.push(
        hideInAnnotationViewOnNarrowScreens(
          getAdministrationSubMenu(collapseAllNavItems, activeUser),
        ),
      );
    } else {
      menuItems.push(hideInAnnotationViewOnNarrowScreens(getTimeTrackingMenu(collapseAllNavItems)));
    }

    trailingNavItems.push(<AnnotationLockedTag key="annotation-locked-tag" />);

    trailingNavItems.push(
      <Button
        key="help-chat-button"
        shape="round"
        color="default"
        variant="filled"
        // Without a label, antd renders a compact icon-only button.
        size={isPhone ? "small" : "middle"}
        icon={<MessageOutlined />}
        onClick={() => setIsHelpModalOpen((isOpen) => !isOpen)}
        title="Ask a Question"
      >
        {isBelowXL ? null : "Ask"}
      </Button>,
    );

    trailingNavItems.push(
      <LoggedInAvatar
        key="logged-in-avatar"
        activeUser={loggedInUser}
        handleLogout={handleLogout}
      />,
    );
  }

  if (!(isAuthenticated || hideNavbarLogin)) {
    trailingNavItems.push(<AnonymousAvatar key="anonymous-avatar" />);
  }

  menuItems.push(
    hideInAnnotationViewOnNarrowScreens(
      getHelpSubMenu(
        version,
        polledVersion,
        isAuthenticated,
        isAdminOrManager,
        collapseAllNavItems,
        () => setIsHelpModalOpen(true),
      ),
    ),
  );
  // Don't highlight active menu items, when showing the narrow version of the navbar,
  // since this makes the icons appear more crowded.
  const selectedKeys = collapseAllNavItems ? [] : [historyLocation.pathname];

  return (
    <NavbarFrame
      menuItems={menuItems}
      trailingNavItems={trailingNavItems}
      menuProps={{
        selectedKeys,
        onOpenChange: (openKeys) => setIsHelpMenuOpen(openKeys.includes(HELP_MENU_KEY)),
      }}
    >
      <HelpModal isModalOpen={isHelpModalOpen} onCancel={() => setIsHelpModalOpen(false)} />
    </NavbarFrame>
  );
}

function Navbar() {
  return isLayerRegistrationWorker() ? <LayerRegistrationWorkerNavbar /> : <DefaultNavbar />;
}

function GlobalProgressBar() {
  const globalProgress = useWkSelector((state) => state.uiInformation.globalProgress);
  const hide = globalProgress === 0;
  return (
    <div
      className={`global-progress-bar ${hide ? "hidden-global-progress-bar" : ""}`}
      style={{ width: `${Math.round(globalProgress * 100)}%` }}
    />
  );
}

export default Navbar;
