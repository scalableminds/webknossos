import {
  listCurrentAndUpcomingMaintenances,
  updateNovelUserExperienceInfos,
} from "admin/admin_rest_api";
import { Alert } from "antd";
import FormattedDate from "components/formatted_date";
import { useInterval } from "libs/react_helpers";
import { navbarHeight } from "navbar";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import { Store } from "oxalis/singletons";
import React, { useState } from "react";
import { MaintenanceInfo } from "types/api_flow_types";

const INTERVAL_TO_FETCH_MAINTENANCES_MS = 60000;

export function MaintenanceBanner() {
  const { activeUser, uiInformation } = Store.getState();
  const topPaddingForNavbar = navbarHeight;
  const statusBarHeight = 20;
  const [currentAndUpcomingMaintenances, setCurrentAndUpcomingMaintenances] = useState<
    Array<MaintenanceInfo>
  >([]);
  const [position, setPosition] = useState<Object>({ top: topPaddingForNavbar });
  const [isTop, setIsTop] = useState(true);
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
    if (closestUpcomingMaintenance == null || activeUsersLatestAcknowledgedMaintenance === closestUpcomingMaintenance.id) return null;
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
          if (uiInformation.isInAnnotationView) {
            toggleTopOrBottomPosition();
          }
        }}
        style={{ ...position, position: uiInformation.isInAnnotationView ? "absolute" : "sticky" }}
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
