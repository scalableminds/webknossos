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
import { APIUser } from "types/api_flow_types";

export function MaintenanceBanner({ activeUser }: { activeUser: APIUser | null | undefined }) {
  const { isInMaintenance } = Store.getState();
  const [currentAndUpcomingMaintenances, setcurrentAndUpcomingMaintenances] = useState<
    Array<MaintenanceInfo>
  >([]);

  useInterval(
    async () => {
      setcurrentAndUpcomingMaintenances(await listCurrentAndUpcomingMaintenances());
    },
    10000, //TODO
    isInMaintenance,
  );
  const activeUsersLatestAcknowledgedMaintenance =
    activeUser?.novelUserExperienceInfos.latestAcknowledgedMaintenanceInfo;

  const saveUserClosedMaintenanceInfo = (closestUpcomingMaintenance: MaintenanceInfo) => {
    if (activeUser == null) return;
    const [newUserSync] = updateNovelUserExperienceInfos(activeUser, {
      latestAcknowledgedMaintenanceInfo: closestUpcomingMaintenance.id,
    });
    Store.dispatch(setActiveUserAction(newUserSync));
  };

  const getClosestUpcomingMaintenanceBanner = (maintenances: MaintenanceInfo[]) => {
    const currentTime = Date.now();
    const closestUpcomingMaintenance = maintenances
      ?.filter((maintenance) => maintenance.startTime > currentTime)
      .sort((a, b) => a.startTime - b.startTime)[0];
    //if (closestUpcomingMaintenance == null || activeUsersLatestAcknowledgedMaintenance === closestUpcomingMaintenance.id) return; //TODO use this after testing
    if (closestUpcomingMaintenance == null) return;
    if (activeUsersLatestAcknowledgedMaintenance === closestUpcomingMaintenance.id)
      return <Alert message="Latest maintenance already acknowledged" type="success" />;
    const startDate = new Date(closestUpcomingMaintenance.startTime);
    const endDate = new Date(closestUpcomingMaintenance.endTime);
    const endDateFormat = startDate.getDate() === endDate.getDate() ? "HH:mm" : "YYYY-MM-DD HH:mm";
    // TODO continue here
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

  const getCurrentMaintenanceBanner = (maintenances: MaintenanceInfo[]) => {
    const currentTime = Date.now();
    const currentMaintenance = maintenances.find(
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
  //if (maintenances?.length === 0||maintenances == null) return (<></>);
  if (currentAndUpcomingMaintenances?.length === 0 || currentAndUpcomingMaintenances == null)
    return <Alert message="No maintenances scheduled or not yet fetched" type="success" closable />; // TODO only for testing, remove me
  const currentlyUnderMaintenanceBanner = getCurrentMaintenanceBanner(currentAndUpcomingMaintenances);
  /*   if (currentlyUnderMaintenanceBanner != null) {
    return currentlyUnderMaintenanceBanner;
  }
  const upcomingMaintenanceBanners = getClosestUpcomingMaintenanceBanner(maintenances);
  return upcomingMaintenanceBanners == null ? <></> : upcomingMaintenanceBanners; */
  return (
    <>
      {getCurrentMaintenanceBanner(currentAndUpcomingMaintenances)}
      {getClosestUpcomingMaintenanceBanner(currentAndUpcomingMaintenances)}
    </>
  );
  //curl -X POST 'http://localhost:9000/api/maintenances' -H 'X-Auth-Token: secretSampleUserToken' -H "Content-Type: application/json" -d '{"startTime":1696516552000, "endTime":1696516852000, "message":"a maintenance!"}'
}
