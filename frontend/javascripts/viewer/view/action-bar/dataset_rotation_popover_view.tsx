import { RollbackOutlined, SyncOutlined } from "@ant-design/icons";
import { Button, Popover } from "antd";
import { V3 } from "libs/mjs";
import { useWkSelector } from "libs/react_hooks";
import type React from "react";
import { useCallback, useMemo } from "react";
import type { EmptyObject } from "types/globals";
import type { Vector3 } from "viewer/constants";
import { getRotationInDegrees } from "viewer/model/accessors/flycam_accessor";
import { setRotationAction } from "viewer/model/actions/flycam_actions";
import Store from "viewer/store";
import { NumberSliderSetting } from "../components/setting_input_views";

const DatasetRotationPopoverButtonView: React.FC<EmptyObject> = () => {
  const flycam = useWkSelector((state) => state.flycam);
  const rotation = useMemo(() => V3.round(getRotationInDegrees(flycam)), [flycam]);

  const handleChangeRotation = useCallback((rotation: Vector3) => {
    Store.dispatch(setRotationAction(rotation));
  }, []);

  return (
    <Popover
      title="Rotation"
      content={
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
        </div>
      }
    >
      <Button icon={<SyncOutlined />} />
    </Popover>
  );
};

export default DatasetRotationPopoverButtonView;
