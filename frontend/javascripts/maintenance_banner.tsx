import {
  listCurrentAndUpcomingMaintenances,
  updateNovelUserExperienceInfos,
} from "admin/admin_rest_api";
import { Alert } from "antd";
import FormattedDate from "components/formatted_date";
import { useFetch, useInterval } from "libs/react_helpers";
import { sleep } from "libs/utils";
import { navbarHeight } from "navbar";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import { Store } from "oxalis/singletons";
import { OxalisState } from "oxalis/store";
import React, { useState } from "react";
import { useSelector } from "react-redux";
import { MaintenanceInfo } from "types/api_flow_types";

const INITIAL_DELAY = 5000;
const INTERVAL_TO_FETCH_MAINTENANCES_MS = 60000;

export function MaintenanceBanner() {
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const { isInAnnotationView } = useSelector((state: OxalisState) => state.uiInformation);
  const topPaddingForNavbar = navbarHeight;
  const statusBarHeight = 20;
  const [currentAndUpcomingMaintenances, setCurrentAndUpcomingMaintenances] = useState<
    Array<MaintenanceInfo>
  >([]);
  const [position, setPosition] = useState<Object>({ top: topPaddingForNavbar });
  const [isTop, setIsTop] = useState(true);

  // Do an initial fetch of the maintenance status so that users are notified
  // quickly in case of ongoing maintenances.
  useFetch(
    async () => {
      await sleep(INITIAL_DELAY);
      setCurrentAndUpcomingMaintenances(await listCurrentAndUpcomingMaintenances());
    },
    null,
    [],
  );
  // Also poll regularly.
  useInterval(async () => {
    setCurrentAndUpcomingMaintenances(await listCurrentAndUpcomingMaintenances());
  }, INTERVAL_TO_FETCH_MAINTENANCES_MS);
  const activeUsersLatestAcknowledgedMaintenance =
    activeUser?.novelUserExperienceInfos.latestAcknowledgedMaintenanceInfo;

  const saveUserClosedMaintenanceInfo = (closestUpcomingMaintenance: MaintenanceInfo) => {
    if (activeUser == null) return;
    const [nextMaintenanceAcknowledged] = updateNovelUserExperienceInfos(activeUser, {
      latestAcknowledgedMaintenanceInfo: closestUpcomingMaintenance.id,
    });
    Store.dispatch(setActiveUserAction(nextMaintenanceAcknowledged));
  };

  const toggleTopOrBottomPosition = () => {
    setPosition(isTop ? { top: topPaddingForNavbar } : { bottom: statusBarHeight });
    setIsTop(!isTop);
  };

  const getClosestUpcomingMaintenanceBanner = () => {
    if (activeUser == null) return null; // upcoming maintenances are only shown after login
    const currentTime = Date.now();
    const closestUpcomingMaintenance = currentAndUpcomingMaintenances
      ?.filter((maintenance) => maintenance.startTime > currentTime)
      .sort((a, b) => a.startTime - b.startTime)[0];
    if (
      closestUpcomingMaintenance == null ||
      activeUsersLatestAcknowledgedMaintenance === closestUpcomingMaintenance.id
    )
      return null;
    const startDate = new Date(closestUpcomingMaintenance.startTime);
    const endDate = new Date(closestUpcomingMaintenance.endTime);
    const endDateFormat = startDate.getDate() === endDate.getDate() ? "HH:mm" : "YYYY-MM-DD HH:mm";
    return (
      <Alert
        message={
          <div>
            Upcoming maintenance: <FormattedDate timestamp={closestUpcomingMaintenance.startTime} />{" "}
            until{" "}
            <FormattedDate timestamp={closestUpcomingMaintenance.endTime} format={endDateFormat} />.{" "}
            {closestUpcomingMaintenance.message}
          </div>
        }
        type="info"
        closable
        banner
        onClose={() => saveUserClosedMaintenanceInfo(closestUpcomingMaintenance)}
      />
    );
  };

  const getCurrentMaintenanceBanner = () => {
    const currentTime = Date.now();
    const currentMaintenance = currentAndUpcomingMaintenances.find(
      (maintenance) => maintenance.startTime < currentTime,
    );
    if (currentMaintenance == null) return;
    return (
      <Alert
        message={
          <>
            Currently under maintenance, scheduled until{" "}
            <FormattedDate timestamp={currentMaintenance.endTime} />. {currentMaintenance.message}
          </>
        }
        type="warning"
        banner
        onMouseEnter={() => {
          if (isInAnnotationView) {
            toggleTopOrBottomPosition();
          }
        }}
        style={{ ...position, position: isInAnnotationView ? "absolute" : "sticky" }}
      />
    );
  };

  if (currentAndUpcomingMaintenances.length === 0) return null;
  const currentlyUnderMaintenanceBanner = getCurrentMaintenanceBanner();
  if (currentlyUnderMaintenanceBanner != null) {
    return currentlyUnderMaintenanceBanner;
  }
  const upcomingMaintenanceBanners = getClosestUpcomingMaintenanceBanner();
  return upcomingMaintenanceBanners == null ? null : upcomingMaintenanceBanners;
}
