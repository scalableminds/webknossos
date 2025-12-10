import { Select, type SelectProps } from "antd";
import { formatVoxels } from "libs/format_utils";
import { computeArrayFromBoundingBox, rgbToHex } from "libs/utils";
import type React from "react";
import { useCallback } from "react";
import type { ArrayElement } from "types/globals";
import type { Vector3 } from "viewer/constants";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import type { UserBoundingBox } from "viewer/store";

function UserBoundingBoxOption({
  bbox,
  showVolume,
}: { bbox: UserBoundingBox | null | undefined; showVolume: boolean }) {
  if (!bbox) {
    return null;
  }

  const upscaledColor = bbox.color.map((colorPart) => colorPart * 255) as any as Vector3;
  const colorAsHexString = rgbToHex(upscaledColor);
  const volumeInVx = new BoundingBox(bbox.boundingBox).getVolume();
  return (
    <>
      <div
        className="color-display-wrapper"
        style={{
          backgroundColor: colorAsHexString,
          marginTop: -2,
          marginRight: 6,
        }}
      />
      {bbox.name} ({computeArrayFromBoundingBox(bbox.boundingBox).join(", ")}
      {showVolume ? `, ${formatVoxels(volumeInVx)}` : ""})
    </>
  );
}

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
    (input: string, option?: ArrayElement<SelectProps["options"]>) =>
      // @ts-ignore: option.label is a React component / React.Node
      String(option?.label?.key ?? "")
        .toLowerCase()
        .indexOf(input.toLowerCase()) >= 0,
    [],
  );

  const options: SelectProps["options"] = userBoundingBoxes.map((userBB) => ({
    value: userBB.id,
    label: <UserBoundingBoxOption key={userBB.name} bbox={userBB} showVolume={showVolume} />,
  }));

  return (
    <Select
      showSearch
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
