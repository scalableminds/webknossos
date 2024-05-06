import {
  getBuildInfo,
  listCurrentAndUpcomingMaintenances,
  updateNovelUserExperienceInfos,
} from "admin/admin_rest_api";
import { Alert, Button, Space } from "antd";
import FormattedDate from "components/formatted_date";
import dayjs from "dayjs";
import { useFetch, useInterval } from "libs/react_helpers";
import { parseCTimeDefaultDate } from "libs/utils";
import _ from "lodash";
import constants from "oxalis/constants";
import { setNavbarHeightAction } from "oxalis/model/actions/ui_actions";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import { Store } from "oxalis/singletons";
import { OxalisState } from "oxalis/store";
import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { MaintenanceInfo } from "types/api_flow_types";
import * as Utils from "libs/utils";

const INITIAL_DELAY = 5000;
const INTERVAL_TO_FETCH_MAINTENANCES_MS = 60000; // 1min
const UPGRADE_BANNER_DISMISSAL_TIMESTAMP_LOCAL_STORAGE_KEY = "upgradeBannerWasClickedAwayy";

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
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
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
      message={
        <div>
          Upcoming maintenance: <FormattedDate timestamp={startTime} /> until{" "}
          <FormattedDate timestamp={endTime} format={endDateFormat} />. {message}
        </div>
      }
      type="info"
      banner
      style={BANNER_STYLE}
      closable
      onClose={() => {
        saveUserClosedMaintenanceInfo(maintenanceInfo);
        setNavbarHeight(constants.DEFAULT_NAVBAR_HEIGHT);
      }}
    />
  );
}

function CurrentMaintenanceBanner({ maintenanceInfo }: { maintenanceInfo: MaintenanceInfo }) {
  const { endTime, message } = maintenanceInfo;

  return (
    <Alert
      message={
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
  const activeUser = useSelector((state: OxalisState) => state.activeUser);

  const [closestUpcomingMaintenance, setClosestUpcomingMaintenance] = useState<
    MaintenanceInfo | undefined
  >(undefined);
  const [currentMaintenance, setCurrentMaintenance] = useState<MaintenanceInfo | undefined>(
    undefined,
  );

  async function pollMaintenances() {
    const newScheduledMaintenances = await listCurrentAndUpcomingMaintenances();

    const closestUpcomingMaintenance = newScheduledMaintenances
      .filter((maintenance) => maintenance.startTime > Date.now())
      .filter(
        (maintenance) =>
          maintenance.id !== activeUser?.novelUserExperienceInfos.latestAcknowledgedMaintenanceInfo,
      )
      .sort((a, b) => a.startTime - b.startTime);

    const currentMaintenance = newScheduledMaintenances.find(
      (maintenance) => maintenance.startTime < Date.now(),
    );

    setCurrentMaintenance(currentMaintenance);
    setClosestUpcomingMaintenance(_.first(closestUpcomingMaintenance));
  }

  useEffect(() => {
    const shouldShowUpcomingMaintenanceBanner =
      closestUpcomingMaintenance != null && activeUser != null;

    if (currentMaintenance || shouldShowUpcomingMaintenanceBanner) {
      setNavbarHeight(constants.DEFAULT_NAVBAR_HEIGHT + constants.BANNER_HEIGHT);
    }

    if (currentMaintenance == null && closestUpcomingMaintenance == null) {
      // Reset Navbar height if maintenance is over
      setNavbarHeight(constants.DEFAULT_NAVBAR_HEIGHT);
    }
  }, [currentMaintenance, closestUpcomingMaintenance, activeUser]);

  useEffect(() => {
    // Do an initial fetch of the maintenance status so that users are notified
    // quickly in case of ongoing maintenances.
    setTimeout(pollMaintenances, INITIAL_DELAY);
  }, []);

  // Also poll regularly.
  useInterval(pollMaintenances, INTERVAL_TO_FETCH_MAINTENANCES_MS);

  if (currentMaintenance) {
    return <CurrentMaintenanceBanner maintenanceInfo={currentMaintenance} />;
  }

  if (closestUpcomingMaintenance && activeUser !== null) {
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
  };
  const currentDate = dayjs();

  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const isVersionOutdated = useFetch(
    async () => {
      Utils.sleep(INITIAL_DELAY);
      let buildInfo = await getBuildInfo();
      buildInfo.webknossos.commitDate = "Wed Apr 24 22:40:38 2023 +0200"; // one year back for testing purposes, TODO remove
      const lastCommitDate = parseCTimeDefaultDate(buildInfo.webknossos.commitDate);
      const needsUpdate = currentDate.diff(lastCommitDate, "month") >= 6;
      return needsUpdate;
    },
    false,
    [],
  );

  const [shouldBannerBeShown, setShouldBannerBeShown] = useState(false);

  useEffect(() => {
    if (!isVersionOutdated || activeUser == null) {
      setShouldBannerBeShown(false);
      return;
    }
    const lastTimeBannerWasClickedAway = localStorage.getItem(
      UPGRADE_BANNER_DISMISSAL_TIMESTAMP_LOCAL_STORAGE_KEY,
    );
    if (lastTimeBannerWasClickedAway == null) {
      setShouldBannerBeShown(true);
      return;
    }

    const parsedDate = dayjs(lastTimeBannerWasClickedAway);
    setShouldBannerBeShown(currentDate.diff(parsedDate, "day") >= 3);
  }, [activeUser, isVersionOutdated, currentDate]);

  useEffect(() => {
    if (shouldBannerBeShown) {
      setNavbarHeight(constants.DEFAULT_NAVBAR_HEIGHT + constants.BANNER_HEIGHT);
    } else {
      setNavbarHeight(constants.DEFAULT_NAVBAR_HEIGHT);
    }
  }, [shouldBannerBeShown]);

  return shouldBannerBeShown ? (
    <Alert
      className="upgrade-banner"
      message={
        <Space size="middle">
          <Space size="small">
            You are using an old version of WEBKNOSSOS. Switch to
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
      closable
      onClose={() => {
        localStorage.setItem(
          UPGRADE_BANNER_DISMISSAL_TIMESTAMP_LOCAL_STORAGE_KEY,
          dayjs().toISOString(),
        );
        setNavbarHeight(constants.DEFAULT_NAVBAR_HEIGHT);
      }}
      type="info"
      showIcon={false}
    />
  ) : null;
}
