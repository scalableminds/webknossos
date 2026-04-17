import { EditOutlined } from "@ant-design/icons";
import { InputNumber, Popover, type PopoverProps } from "antd";

type NumberInputPopoverSettingProps = {
  onChange: (value: number) => void;
  value: number | null | undefined;
  label: string | React.ReactNode;
  detailedLabel: string | React.ReactNode;
  placement?: PopoverProps["placement"];
  max?: number;
  min?: number;
  step?: number;
};

export function NumberInputPopoverSetting(props: NumberInputPopoverSettingProps) {
  const { min, max, onChange, step, value, label, detailedLabel } = props;
  const placement: PopoverProps["placement"] = props.placement || "top";
  const onChangeGuarded = (val: number | null) => {
    if (val != null) {
      onChange(val);
    }
  };
  const numberInput = (
    <div>
      <div
        style={{
          marginBottom: 8,
        }}
      >
        {detailedLabel}:
      </div>
      <InputNumber
        controls={false}
        style={{
          width: 140,
        }}
        min={min}
        max={max}
        onChange={onChangeGuarded}
        value={value}
        step={step}
        size="small"
        variant="borderless"
      />
    </div>
  );
  return (
    <Popover content={numberInput} trigger="click" placement={placement}>
      <span
        style={{
          cursor: "pointer",
        }}
      >
        {label} {value != null ? value : "-"}
        <EditOutlined
          style={{
            fontSize: 11,
            opacity: 0.7,
            margin: "0 0px 5px 3px",
          }}
        />
      </span>
    </Popover>
  );
}
