import { Select, type SelectProps } from "antd";
import type React from "react";
import { useCallback } from "react";
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
  const filterOption = useCallback(
    (input: string, option?: SelectProps["options"]) =>
      String(option?.label ?? "")
        .toLowerCase()
        .indexOf(input.toLowerCase()) >= 0,
    [],
  );

  const options: SelectProps["options"] = userBoundingBoxes.map((userBB) => ({
    value: userBB.id,
    label: renderUserBoundingBox(userBB, showVolume),
  }));

  return (
    <Select
      placeholder="Select a bounding box"
      optionFilterProp="children"
      options={options}
      filterOption={filterOption}
      disabled={userBoundingBoxes.length < 1}
      onSelect={setSelectedBoundingBoxId}
      style={style}
      value={value}
    />
  );
}
