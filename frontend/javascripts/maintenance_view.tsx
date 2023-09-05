import { MaintenanceInfo, listCurrentAndUpcomingMaintenances } from "admin/admin_rest_api";
import { Alert, Tooltip } from "antd";
import { useFetch } from "libs/react_helpers";
import React from "react";

const getClosestUpcomingMaintenanceBanner = (maintenances: MaintenanceInfo[]) => {
  const currentTime = Date.now();
  const closestUpcomingMaintenance = maintenances
    ?.filter((maintenance) => maintenance.startTime > currentTime)
    .sort((a, b) => a.startTime - b.startTime)[0];
  if (closestUpcomingMaintenance == null) return;
  return (
    <Tooltip title={closestUpcomingMaintenance.message}>
      <Alert
        message={`Next upcoming maintenance: ${new Date(
          closestUpcomingMaintenance.startTime,
        ).toLocaleString()} until ${new Date(closestUpcomingMaintenance.endTime).toLocaleString()}`}
        type="info"
        closable
        banner
      />
    </Tooltip>
  );
};

const getCurrentMaintenanceBanner = (maintenances: MaintenanceInfo[]) => {
  const currentTime = Date.now();
  const currentMaintenance = maintenances.find(
    (maintenance) => maintenance.startTime < currentTime && maintenance.endTime > currentTime,
  );
  if (currentMaintenance == null) return;
  return (
    <Tooltip title={currentMaintenance.message}>
      <Alert
        message={`Currently under maintenance, presumably until ${new Date(
          currentMaintenance.endTime,
        ).toLocaleString()}`}
        type="warning"
        closable
        banner
      />
    </Tooltip>
  );
};

export function MaintenanceBanner() {
  const maintenances = useFetch(() => listCurrentAndUpcomingMaintenances(), null, []);
  //if (maintenances?.length === 0||maintenances == null) return (<></>);
  if (maintenances?.length === 0 || maintenances == null)
    return <Alert message="No maintenances scheduled or not yet fetched" type="success" closable />; // TODO only for testing, remove me
  const currentlyUnderMaintenanceBanner = getCurrentMaintenanceBanner(maintenances);
  if (currentlyUnderMaintenanceBanner != null) {
    return currentlyUnderMaintenanceBanner;
  }
  const upcomingMaintenanceBanners = getClosestUpcomingMaintenanceBanner(maintenances);
  return upcomingMaintenanceBanners == null ? <></> : upcomingMaintenanceBanners;
  //curl -X POST 'http://localhost:9000/api/maintenances' -H 'X-Auth-Token: secretSampleUserToken' -H "Content-Type: application/json" -d '{"startTime":1696516552000, "endTime":1696516852000, "message":"a maintenance!"}'
}
