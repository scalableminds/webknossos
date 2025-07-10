import { ReloadOutlined } from "@ant-design/icons";
import { Space } from "antd";
import FastTooltip from "components/fast_tooltip";
import { V3 } from "libs/mjs";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { Vector3Input } from "libs/vector_input";
import message from "messages";
import type { Vector3 } from "viewer/constants";
import { getRotation } from "viewer/model/accessors/flycam_accessor";
import { setRotationAction } from "viewer/model/actions/flycam_actions";
import Store from "viewer/store";
import ButtonComponent from "viewer/view/components/button_component";

function RotationView() {
  const flycam = useWkSelector((state) => state.flycam);

  const copyRotationToClipboard = async () => {
    const rotation = V3.round(getRotation(flycam)).join(", ");
    await navigator.clipboard.writeText(rotation);
    Toast.success("Rotation copied to clipboard");
  };

  const handleChangeRotation = (rotation: Vector3) => {
    Store.dispatch(setRotationAction(rotation));
  };

  const rotation = V3.round(getRotation(flycam));

  return (
    <Space.Compact
      style={{
        whiteSpace: "nowrap",
        marginLeft: 10,
      }}
    >
      <FastTooltip title={message["tracing.copy_rotation"]} placement="bottom-start">
        <ButtonComponent
          onClick={copyRotationToClipboard}
          style={{
            padding: "0 10px",
          }}
          className="hide-on-small-screen"
        >
          <ReloadOutlined />
        </ButtonComponent>
      </FastTooltip>
      <Vector3Input
        value={rotation}
        onChange={handleChangeRotation}
        style={{
          textAlign: "center",
          width: 120,
        }}
        allowDecimals
      />
    </Space.Compact>
  );
}

export default RotationView;
