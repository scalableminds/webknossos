import {
  getBuildInfo,
  listCurrentAndUpcomingMaintenances,
  updateNovelUserExperienceInfos,
} from "admin/admin_rest_api";
import { Alert, Button, Space } from "antd";
import FormattedDate from "components/formatted_date";
import dayjs from "dayjs";
import { useFetch, useInterval } from "libs/react_helpers";
import _ from "lodash";
import constants from "oxalis/constants";
import { setNavbarHeightAction } from "oxalis/model/actions/ui_actions";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import { Store } from "oxalis/singletons";
import { OxalisState } from "oxalis/store";
import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { MaintenanceInfo } from "types/api_flow_types";

const INITIAL_DELAY = 5000;
const INTERVAL_TO_FETCH_MAINTENANCES_MS = 60000; // 1min
const UPGRADE_BANNER_LOCAL_STORAGE_KEY = "upgradeBannerWasClickedAway";

const BANNER_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  height: constants.MAINTENANCE_BANNER_HEIGHT,
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
    if (currentMaintenance || closestUpcomingMaintenance) {
      setNavbarHeight(constants.DEFAULT_NAVBAR_HEIGHT + constants.MAINTENANCE_BANNER_HEIGHT);
    }

    if (currentMaintenance == null && closestUpcomingMaintenance == null) {
      // Reset Navbar height if maintenance is over
      setNavbarHeight(constants.DEFAULT_NAVBAR_HEIGHT);
    }
  }, [currentMaintenance, closestUpcomingMaintenance]);

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
  const UPGRADE_BANNER_STYLE: React.CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    height: constants.UPGRADE_BANNER_HEIGHT,
    textAlign: "center",
    backgroundColor: "var(--ant-color-primary)",
    color: "var(--ant-color-text-primary)",
    fontWeight: 600,
    fontSize: "medium",
  };
  const customParseFormat = require("dayjs/plugin/customParseFormat");
  dayjs.extend(customParseFormat);
  const currentDate = dayjs();

  const isVersionOutdated = useFetch(
    async () => {
      const buildInfo = await getBuildInfo();
      const commitDateWithoutWeekday = buildInfo.webknossos.commitDate.replace(
        /(Mon)|(Tue)|(Wed)|(Thu)|(Fri)|(Sat)|(Sun)\w*/,
        "",
      );
      console.log(commitDateWithoutWeekday);
      const lastCommitDate = dayjs(commitDateWithoutWeekday, "MMM DD HH:mm:ss YYYY ZZ"); // todo two digit dates? test more once time tracking is merged
      console.log(lastCommitDate);
      const needsUpdate = currentDate.diff(lastCommitDate, "month") >= 6;
      console.log(needsUpdate);
      return needsUpdate;
    },
    false,
    [],
  );

  const getShouldBannerBeShown = () => {
    if (!isVersionOutdated) return true; // TODO
    const lastTimeBannerWasClickedAway = localStorage.getItem(UPGRADE_BANNER_LOCAL_STORAGE_KEY);
    console.log(lastTimeBannerWasClickedAway);
    if (lastTimeBannerWasClickedAway == null) return true;
    const parsedDate = dayjs(lastTimeBannerWasClickedAway);
    return parsedDate.diff(currentDate, "days") >= 3;
  };

  const shouldBannerBeShown = getShouldBannerBeShown();

  useEffect(() => {
    if (shouldBannerBeShown) {
      setNavbarHeight(constants.DEFAULT_NAVBAR_HEIGHT + constants.UPGRADE_BANNER_HEIGHT);
    } else {
      setNavbarHeight(constants.DEFAULT_NAVBAR_HEIGHT);
    }
  }, [shouldBannerBeShown]);

  return shouldBannerBeShown ? (
    <Alert
      message={
        <Space size="middle">
          <Space size="small">
            You are using an old version of WEBKNOSSOS. Switch to <b>webknossos.org</b> for
            automatic updates and exclusive features!
          </Space>
          <Button className="upgrade-banner" href="https://webknossos.org/self-hosted-upgrade">
            {" "}
            Learn more{" "}
          </Button>
        </Space>
      }
      banner
      style={UPGRADE_BANNER_STYLE}
      closable
      onClose={() => {
        localStorage.setItem(UPGRADE_BANNER_LOCAL_STORAGE_KEY, dayjs().toISOString());
        setNavbarHeight(constants.DEFAULT_NAVBAR_HEIGHT);
      }}
      type="info"
      showIcon={false}
    />
  ) : null;
}
