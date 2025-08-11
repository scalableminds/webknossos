import { Select } from "antd";
import type React from "react";
import type { UserBoundingBox } from "viewer/store";
import { renderUserBoundingBox } from "../utils";

export function BoundingBoxSelection({
  userBoundingBoxes,
  setSelectedBoundingBoxId,
  showVolume = false,
  style,
  value,
}: {
  userBoundingBoxes: UserBoundingBox[];
  setSelectedBoundingBoxId?: (boundingBoxId: number | null) => void;
  showVolume?: boolean;
  style?: React.CSSProperties;
  value: number | null;
}): JSX.Element {
  return (
    <Select
      placeholder="Select a bounding box"
      optionFilterProp="children"
      filterOption={(input, option) =>
        // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
        option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
      }
      disabled={userBoundingBoxes.length < 1}
      onSelect={setSelectedBoundingBoxId}
      style={style}
      value={value}
    >
      {userBoundingBoxes.map((userBB) => (
        <Select.Option key={userBB.id} value={userBB.id}>
          {renderUserBoundingBox(userBB, showVolume)}
        </Select.Option>
      ))}
    </Select>
  );
}
