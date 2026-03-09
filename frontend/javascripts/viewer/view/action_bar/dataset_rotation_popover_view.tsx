import { RollbackOutlined, SyncOutlined } from "@ant-design/icons";
import { Button, Col, Popover, Row, Switch } from "antd";
import { useWkSelector } from "libs/react_hooks";
import type React from "react";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import type { EmptyObject } from "types/type_utils";
import type { Vector3 } from "viewer/constants";
import { isRotated } from "viewer/model/accessors/flycam_accessor";
import { setRotationAction } from "viewer/model/actions/flycam_actions";
import { setViewModeAction } from "viewer/model/actions/settings_actions";
import { NumberSliderSetting } from "../components/setting_input_views";

const warningColors: React.CSSProperties = {
  color: "rgb(255, 155, 85)",
  borderColor: "rgb(241, 122, 39)",
};

const PopoverContent: React.FC<EmptyObject> = () => {
  const dispatch = useDispatch();
  const rotation = useWkSelector((state) => state.flycam.rotation);
  const allowedModes = useWkSelector((state) => state.annotation.restrictions.allowedModes);
  const handleChangeRotation = useCallback(
    (rotation: Vector3) => {
      dispatch(setRotationAction(rotation));
    },
    [dispatch],
  );

  const setViewMode = useCallback(
    (checked: boolean) => {
      dispatch(setViewModeAction(checked ? "flight" : "orthogonal"));
    },
    [dispatch],
  );

  return (
    <div>
      <div>
        <NumberSliderSetting
          label="X"
          min={0}
          max={360}
          step={1}
          value={rotation[0]}
          onChange={(newValue) => handleChangeRotation([newValue, rotation[1], rotation[2]])}
          spans={[3, 13, 4, 4]}
          postComponent={
            <Button
              type="text"
              icon={<RollbackOutlined />}
              onClick={() => handleChangeRotation([0, rotation[1], rotation[2]])}
            />
          }
        />
      </div>
      <div>
        <NumberSliderSetting
          label="Y"
          min={0}
          max={360}
          step={1}
          value={rotation[1]}
          onChange={(newValue) => handleChangeRotation([rotation[0], newValue, rotation[2]])}
          spans={[3, 13, 4, 4]}
          postComponent={
            <Button
              type="text"
              icon={<RollbackOutlined />}
              onClick={() => handleChangeRotation([rotation[0], 0, rotation[2]])}
            />
          }
        />
      </div>
      <div>
        <NumberSliderSetting
          label="Z"
          min={0}
          max={360}
          step={1}
          value={rotation[2]}
          onChange={(newValue) => handleChangeRotation([rotation[0], rotation[1], newValue])}
          spans={[3, 13, 4, 4]}
          postComponent={
            <Button
              type="text"
              icon={<RollbackOutlined />}
              onClick={() => handleChangeRotation([rotation[0], rotation[1], 0])}
            />
          }
        />
      </div>
      <div>
        <Row>
          <Col span={10} offset={13}>
            <Button
              type="text"
              icon={<RollbackOutlined />}
              iconPlacement="end"
              onClick={() => handleChangeRotation([0, 0, 0])}
            >
              Reset all
            </Button>
          </Col>
        </Row>
      </div>
      <Row>
        <Col>Flight Mode</Col>
        <Col offset={11}>
          <Switch
            disabled={!allowedModes.includes("flight")}
            onChange={setViewMode}
            value={useWkSelector((state) => state.temporaryConfiguration.viewMode) === "flight"}
          />
        </Col>
      </Row>
    </div>
  );
};

const DatasetRotationPopoverButtonView: React.FC<{ style: React.CSSProperties }> = ({ style }) => {
  const isFlycamRotated = useWkSelector((state) => isRotated(state.flycam));
  const maybeWarningStyle = isFlycamRotated ? { ...style, ...warningColors, zIndex: 1 } : style;
  return (
    <Popover title="Rotation" content={<PopoverContent />}>
      <Button icon={<SyncOutlined />} style={maybeWarningStyle} />
    </Popover>
  );
};

export default DatasetRotationPopoverButtonView;
