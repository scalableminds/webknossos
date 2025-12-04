import {
  getBuildInfo,
  listCurrentAndUpcomingMaintenances,
  updateNovelUserExperienceInfos,
} from "admin/rest_api";
import { Alert, Button, Space } from "antd";
import FormattedDate from "components/formatted_date";
import dayjs from "dayjs";
import { useFetch, useInterval } from "libs/react_helpers";
import { useWkSelector } from "libs/react_hooks";
import { parseCTimeDefaultDate } from "libs/utils";
import * as Utils from "libs/utils";
import _ from "lodash";
import type React from "react";
import { useCallback, useEffect, useReducer, useState } from "react";
import type { MaintenanceInfo } from "types/api_types";
import constants from "viewer/constants";
import { setNavbarHeightAction } from "viewer/model/actions/ui_actions";
import { setActiveUserAction } from "viewer/model/actions/user_actions";
import { Store } from "viewer/singletons";

const INITIAL_DELAY = 5000;
const INTERVAL_TO_FETCH_MAINTENANCES_MS = 60000; // 1min
const UPGRADE_BANNER_DISMISSAL_TIMESTAMP_LOCAL_STORAGE_KEY = "upgradeBannerWasClickedAway";

const BANNER_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  height: constants.BANNER_HEIGHT,
};

function setNavbarHeight(newNavbarHeight: number) {
  Store.dispatch(setNavbarHeightAction(newNavbarHeight));
  document.documentElement.style.setProperty("--navbar-height", `${newNavbarHeight}px`);
}

function UpcomingMaintenanceBanner({ maintenanceInfo }: { maintenanceInfo: MaintenanceInfo }) {
  const activeUser = useWkSelector((state) => state.activeUser);
  const { startTime, endTime, message } = maintenanceInfo;

  const startDate = new Date(startTime);
  const endDate = new Date(endTime);
  const endDateFormat = startDate.getDate() === endDate.getDate() ? "HH:mm" : "YYYY-MM-DD HH:mm";

  const saveUserClosedMaintenanceInfo = (closestUpcomingMaintenance: MaintenanceInfo) => {
    if (activeUser == null) return;

    const [nextMaintenanceAcknowledged] = updateNovelUserExperienceInfos(activeUser, {
      latestAcknowledgedMaintenanceInfo: closestUpcomingMaintenance.id,
    });
    Store.dispatch(setActiveUserAction(nextMaintenanceAcknowledged));
  };

  return (
    <Alert
      title={
        <div>
          Upcoming maintenance: <FormattedDate timestamp={startTime} /> until{" "}
          <FormattedDate timestamp={endTime} format={endDateFormat} />. {message}
        </div>
      }
      type="info"
      banner
      style={BANNER_STYLE}
      closable={{
        onClose: () => {
          saveUserClosedMaintenanceInfo(maintenanceInfo);
          setNavbarHeight(constants.DEFAULT_NAVBAR_HEIGHT);
        },
      }}
    />
  );
}

function CurrentMaintenanceBanner({ maintenanceInfo }: { maintenanceInfo: MaintenanceInfo }) {
  const { endTime, message } = maintenanceInfo;

  return (
    <Alert
      title={
        <>
          Currently under maintenance, scheduled until <FormattedDate timestamp={endTime} />.{" "}
          {message}
        </>
      }
      type="warning"
      banner
      style={BANNER_STYLE}
    />
  );
}

export function MaintenanceBanner() {
  const activeUser = useWkSelector((state) => state.activeUser);

  const [closestUpcomingMaintenance, setClosestUpcomingMaintenance] = useState<
    MaintenanceInfo | undefined
  >(undefined);
  const [currentMaintenance, setCurrentMaintenance] = useState<MaintenanceInfo | undefined>(
    undefined,
  );

  const pollMaintenances = useCallback(async () => {
    const newScheduledMaintenances = await listCurrentAndUpcomingMaintenances();

    const upcomingMaintenances = newScheduledMaintenances
      .filter((maintenance) => maintenance.startTime > Date.now())
      .filter(
        (maintenance) =>
          maintenance.id !== activeUser?.novelUserExperienceInfos.latestAcknowledgedMaintenanceInfo,
      )
      .sort((a, b) => a.startTime - b.startTime);

    const currentMaintenance = newScheduledMaintenances.find(
      (maintenance) => maintenance.startTime < Date.now() && maintenance.endTime > Date.now(),
    );

    setCurrentMaintenance(currentMaintenance);
    setClosestUpcomingMaintenance(_.first(upcomingMaintenances));
  }, [activeUser]);

  useEffect(() => {
    // Do an initial fetch of the maintenance status so that users are notified
    // quickly in case of ongoing maintenances.
    const timerId = setTimeout(pollMaintenances, INITIAL_DELAY);
    return () => clearTimeout(timerId);
  }, [pollMaintenances]);

  // Also poll regularly.
  useInterval(pollMaintenances, INTERVAL_TO_FETCH_MAINTENANCES_MS);

  const showCurrentMaintenanceBanner = currentMaintenance != null;
  const showUpcomingMaintenanceBanner = closestUpcomingMaintenance != null && activeUser != null;

  useEffect(() => {
    const isBannerVisible = showCurrentMaintenanceBanner || showUpcomingMaintenanceBanner;
    const newNavbarHeight = isBannerVisible
      ? constants.DEFAULT_NAVBAR_HEIGHT + constants.BANNER_HEIGHT
      : constants.DEFAULT_NAVBAR_HEIGHT;
    setNavbarHeight(newNavbarHeight);
  }, [showCurrentMaintenanceBanner, showUpcomingMaintenanceBanner]);

  if (showCurrentMaintenanceBanner) {
    return <CurrentMaintenanceBanner maintenanceInfo={currentMaintenance} />;
  }

  if (showUpcomingMaintenanceBanner) {
    return <UpcomingMaintenanceBanner maintenanceInfo={closestUpcomingMaintenance} />;
  }

  return null;
}

export function UpgradeVersionBanner() {
  const white = "var(--ant-color-text-primary)";
  const blue = "var(--ant-color-primary)";
  const UPGRADE_BANNER_STYLE: React.CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    height: constants.BANNER_HEIGHT,
    textAlign: "center",
    backgroundColor: blue,
    color: white,
    fontSize: "medium",
    minWidth: "fit-content",
    zIndex: 999,
  };

  const activeUser = useWkSelector((state) => state.activeUser);
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  const isVersionOutdated = useFetch(
    async () => {
      if (!activeUser) return false;
      await Utils.sleep(INITIAL_DELAY);
      const buildInfo = await getBuildInfo();
      const lastCommitDate = parseCTimeDefaultDate(buildInfo.webknossos.commitDate);
      const needsUpdate = dayjs().diff(lastCommitDate, "month") >= 6;
      return needsUpdate;
    },
    false,
    [activeUser],
  );

  const lastTimeBannerWasClickedAway = localStorage.getItem(
    UPGRADE_BANNER_DISMISSAL_TIMESTAMP_LOCAL_STORAGE_KEY,
  );

  const shouldBannerBeShown =
    isVersionOutdated &&
    activeUser != null &&
    (lastTimeBannerWasClickedAway == null ||
      dayjs().diff(dayjs(lastTimeBannerWasClickedAway), "day") >= 3);

  useEffect(() => {
    const newNavbarHeight = shouldBannerBeShown
      ? constants.DEFAULT_NAVBAR_HEIGHT + constants.BANNER_HEIGHT
      : constants.DEFAULT_NAVBAR_HEIGHT;
    setNavbarHeight(newNavbarHeight);
  }, [shouldBannerBeShown]);

  return shouldBannerBeShown ? (
    <Alert
      className="upgrade-banner"
      title={
        <Space size="middle">
          <Space size="small">
            You are using an outdated version of WEBKNOSSOS. Switch to
            <a
              className="upgrade-banner-wk-link"
              target="_blank"
              href="https://webknossos.org"
              rel="noreferrer noopener"
            >
              webknossos.org
            </a>
            for automatic updates and exclusive features!
          </Space>
          <Button
            className="upgrade-banner-button"
            href="https://webknossos.org/self-hosted-upgrade"
            size="small"
          >
            Learn more
          </Button>
        </Space>
      }
      banner
      style={UPGRADE_BANNER_STYLE}
      closable={{
        onClose: () => {
          localStorage.setItem(
            UPGRADE_BANNER_DISMISSAL_TIMESTAMP_LOCAL_STORAGE_KEY,
            dayjs().toISOString(),
          );
          forceUpdate();
        },
      }}
      type="info"
      showIcon={false}
    />
  ) : null;
}
