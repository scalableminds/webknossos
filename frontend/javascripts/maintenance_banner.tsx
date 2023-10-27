import {
  listCurrentAndUpcomingMaintenances,
  updateNovelUserExperienceInfos,
} from "admin/admin_rest_api";
import { Alert } from "antd";
import FormattedDate from "components/formatted_date";
import { useInterval } from "libs/react_helpers";
import constants from "oxalis/constants";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import { Store } from "oxalis/singletons";
import { OxalisState } from "oxalis/store";
import React, { useState } from "react";
import { useSelector } from "react-redux";
import { MaintenanceInfo } from "types/api_flow_types";

const INITIAL_DELAY = 5000;
const INTERVAL_TO_FETCH_MAINTENANCES_MS = 60000;

const BANNER_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  height: 38,
};

function UpcomingMaintenanceBanner({ maintenanceInfo }: {maintenanceInfo:MaintenanceInfo}) {
  const {startTime, endTime, message} = maintenanceInfo
  
  const startDate = new Date(startTime);
  const endDate = new Date(endTime);
  const endDateFormat = startDate.getDate() === endDate.getDate() ? "HH:mm" : "YYYY-MM-DD HH:mm";
  
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
      />
      );
    }
    
    function CurrentMaintenanceBanner({ maintenanceInfo }: {maintenanceInfo:MaintenanceInfo}) {
      const {endTime, message} = maintenanceInfo
      
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

  const [currentAndUpcomingMaintenances, setCurrentAndUpcomingMaintenances] = useState<
    MaintenanceInfo[]
  >([]);

  function setNavbarHeight() {
    const newNavbarHeight = 48 + 38;
    constants.NAVBAR_HEIGHT = newNavbarHeight; // TODO
    document.documentElement.style.setProperty("--navbar-height", `${newNavbarHeight}px`);
  }

  async function pollMaintenances() {
    const scheduledMaintenances = await listCurrentAndUpcomingMaintenances();
    setCurrentAndUpcomingMaintenances(scheduledMaintenances);

    if (scheduledMaintenances.length > 0) {
      setNavbarHeight();
    }
  }

  // Do an initial fetch of the maintenance status so that users are notified
  // quickly in case of ongoing maintenances.
  setTimeout(pollMaintenances, INITIAL_DELAY);

  // Also poll regularly.
  useInterval(pollMaintenances, INTERVAL_TO_FETCH_MAINTENANCES_MS);

  const activeUsersLatestAcknowledgedMaintenance =
    activeUser?.novelUserExperienceInfos.latestAcknowledgedMaintenanceInfo;

  const saveUserClosedMaintenanceInfo = (closestUpcomingMaintenance: MaintenanceInfo) => {
    if (activeUser == null) return;
    const [nextMaintenanceAcknowledged] = updateNovelUserExperienceInfos(activeUser, {
      latestAcknowledgedMaintenanceInfo: closestUpcomingMaintenance.id,
    });
    Store.dispatch(setActiveUserAction(nextMaintenanceAcknowledged));
  };

  const closestUpcomingMaintenance = currentAndUpcomingMaintenances
    .filter((maintenance) => maintenance.startTime > Date.now())
    .sort((a, b) => a.startTime - b.startTime)
    ;

  const currentMaintenance = currentAndUpcomingMaintenances.find(
    (maintenance) => maintenance.startTime < Date.now(),
  );

  if (currentMaintenance) {
    return (
      <CurrentMaintenanceBanner
        maintenanceInfo={currentMaintenance}
      />
    );
  }

  if (closestUpcomingMaintenance.length > 0 && activeUser !== null) {
    return <UpcomingMaintenanceBanner maintenanceInfo={closestUpcomingMaintenance[0]} />;
  }

  return null
}
