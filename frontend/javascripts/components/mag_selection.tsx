import { Form, Select } from "antd";
import { V3 } from "libs/mjs";
import { clamp } from "libs/utils";
import type { Vector3 } from "oxalis/constants";
import type { MagInfo } from "oxalis/model/helpers/mag_info";

export function MagSelectionFormItem({
  name,
  magInfo,
}: {
  name: string | Array<string | number>;
  magInfo: MagInfo | undefined;
}): JSX.Element {
  return (
    <Form.Item
      name={name}
      label={"Magnification"}
      rules={[
        {
          required: true,
          message: "Please select the magnification.",
        },
      ]}
    >
      <MagSelection magInfo={magInfo} />
    </Form.Item>
  );
}

function MagSelection({
  magInfo,
  value,
  onChange,
}: {
  magInfo: MagInfo | undefined;
  value?: Vector3;
  onChange?: (a: Vector3) => void;
}): JSX.Element {
  const allMags = magInfo != null ? magInfo.getMagList() : [];

  const onSelect = (index: number | undefined) => {
    if (onChange == null || index == null) return;
    const newMag = allMags[index];
    if (newMag != null) onChange(newMag);
  };

  return (
    <Select
      placeholder="Select a magnification"
      value={
        // using the index of the mag *in the mag list* as value internally
        // NB: this is different from the mag index
        value == null || magInfo == null
          ? null
          : clamp(
              0,
              allMags.findIndex((v) => V3.equals(v, value)),
              allMags.length - 1,
            )
      }
      onSelect={onSelect}
    >
      {allMags.map((mag, index) => {
        const readableName = mag.join("-");
        return (
          <Select.Option key={index} value={index}>
            {readableName}
          </Select.Option>
        );
      })}
    </Select>
  );
}
