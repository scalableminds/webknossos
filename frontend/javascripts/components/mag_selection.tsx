import { Form, Select } from "antd";
import type { Vector3 } from "oxalis/constants";

export function MagSelectionFormItem({
  name,
  mags,
}: { name: string; mags: Vector3[] }): JSX.Element {
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
      <MagSelection mags={mags} />
    </Form.Item>
  );
}

function MagSelection({ mags }: { mags: Vector3[] }): JSX.Element {
  return (
    <Select>
      placeholder="Select a magnification"
      {mags.map((mag) => {
        const readableName = mag.join("-");
        return (
          <Select.Option key={readableName} value={readableName}>
            {readableName}
          </Select.Option>
        );
      })}
    </Select>
  );
}
