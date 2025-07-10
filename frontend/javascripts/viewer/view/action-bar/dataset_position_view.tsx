import { useWkSelector } from "libs/react_hooks";
import constants from "viewer/constants";
import PositionView from "./position_view";
import RotationView from "./rotation_view";

function DatasetPositionView() {
  const viewMode = useWkSelector((state) => state.temporaryConfiguration.viewMode);
  const isArbitraryMode = constants.MODES_ARBITRARY.includes(viewMode);

  return (
    <div
      style={{
        display: "flex",
      }}
    >
      <PositionView />
      {isArbitraryMode ? <RotationView /> : null}
    </div>
  );
}

export default DatasetPositionView;
