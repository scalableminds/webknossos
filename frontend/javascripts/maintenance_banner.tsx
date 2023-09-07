import {
  MaintenanceInfo,
  listCurrentAndUpcomingMaintenances,
  updateNovelUserExperienceInfos,
} from "admin/admin_rest_api";
import { Alert } from "antd";
import FormattedDate from "components/formatted_date";
import { useInterval } from "libs/react_helpers";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import { Store } from "oxalis/singletons";
import React, { useState } from "react";

export function MaintenanceBanner() {
  const { activeUser } = Store.getState();
  const [currentAndUpcomingMaintenances, setcurrentAndUpcomingMaintenances] = useState<
    Array<MaintenanceInfo>
  >([]);

  useInterval(
    async () => {
      if (activeUser == null) return;
      setcurrentAndUpcomingMaintenances(await listCurrentAndUpcomingMaintenances());
    },
    10000, //TODO find value for production
  );
  if (activeUser == null) return <></>;
  const activeUsersLatestAcknowledgedMaintenance =
    activeUser?.novelUserExperienceInfos.latestAcknowledgedMaintenanceInfo;

  const saveUserClosedMaintenanceInfo = (closestUpcomingMaintenance: MaintenanceInfo) => {
    if (activeUser == null) return;
    const [nextMaintenanceAcknowledged] = updateNovelUserExperienceInfos(activeUser, {
      latestAcknowledgedMaintenanceInfo: closestUpcomingMaintenance.id,
    });
    Store.dispatch(setActiveUserAction(nextMaintenanceAcknowledged));
  };

  const getClosestUpcomingMaintenanceBanner = () => {
    const currentTime = Date.now();
    const closestUpcomingMaintenance = currentAndUpcomingMaintenances
      ?.filter((maintenance) => maintenance.startTime > currentTime)
      .sort((a, b) => a.startTime - b.startTime)[0];
    //if (closestUpcomingMaintenance == null || activeUsersLatestAcknowledgedMaintenance === closestUpcomingMaintenance.id) return; //TODO use this after testing and remove next 3 lines
    if (closestUpcomingMaintenance == null) return;
    if (activeUsersLatestAcknowledgedMaintenance === closestUpcomingMaintenance.id)
      return <Alert message="Latest maintenance already acknowledged" type="success" />;
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
      (maintenance) => maintenance.startTime < currentTime && maintenance.endTime > currentTime,
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
      />
    );
  };

  if (currentAndUpcomingMaintenances?.length === 0 || currentAndUpcomingMaintenances == null)
    return <></>;
  const currentlyUnderMaintenanceBanner = getCurrentMaintenanceBanner();
  if (currentlyUnderMaintenanceBanner != null) {
    return currentlyUnderMaintenanceBanner;
  }
  const upcomingMaintenanceBanners = getClosestUpcomingMaintenanceBanner();
  return upcomingMaintenanceBanners == null ? <></> : upcomingMaintenanceBanners;
}
