import { Form, Select } from "antd";
import { V3 } from "libs/mjs";
import { clamp } from "libs/utils";
import _ from "lodash";
import type { Vector3 } from "oxalis/constants";
import type { MagInfo } from "oxalis/model/helpers/mag_info";

export function MagSelectionFormItem({
  name,
  magInfo,
  value,
}: {
  name: string | Array<string | number>;
  magInfo: MagInfo | undefined;
  value?: Vector3;
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
      <MagSelection magInfo={magInfo} value={value} />
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
  const allMags = magInfo != null ? magInfo.getMagsWithIndices() : [];

  return (
    <Select
      placeholder="Select a magnification"
      value={
        // using the index of the mag as value internally
        value == null || magInfo == null
          ? null
          : clamp(
              0,
              allMags.findIndex(([, v]) => V3.equals(v, value)),
              allMags.length - 1,
            )
      }
      onSelect={onChange != null ? (value) => onChange(allMags[value][1]) : _.noop}
    >
      {allMags.map((mag) => {
        const readableName = mag[1].join("-");
        const index = mag[0];
        console.log("mag", mag);
        return (
          <Select.Option key={index} value={index}>
            {readableName}
          </Select.Option>
        );
      })}
    </Select>
  );
}
