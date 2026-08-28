import { EditOutlined } from "@ant-design/icons";
import { InputNumber, Popover, type PopoverProps } from "antd";

type NumberInputPopoverSettingProps<T extends number | bigint> = {
  onChange: (value: T) => void;
  value: T | null | undefined;
  label: string | React.ReactNode;
  detailedLabel: string | React.ReactNode;
  placement?: PopoverProps["placement"];
  max?: T;
  min?: T;
  step?: number;
};

export function NumberInputPopoverSetting<T extends number | bigint>(
  props: NumberInputPopoverSettingProps<T>,
) {
  const { min, max, onChange, step, value, label, detailedLabel } = props;
  const placement: PopoverProps["placement"] = props.placement || "top";
  // Detect whether we operate on bigint (uint64 segment ids). In that case the input uses antd's
  // high-precision stringMode instead of JS numbers, which would truncate ids above 2**53.
  const isBigInt = typeof value === "bigint" || typeof min === "bigint" || typeof max === "bigint";

  const onChangeGuarded = (val: string | null) => {
    if (val == null || val === "") {
      return;
    }
    try {
      onChange((isBigInt ? BigInt(val) : Number(val)) as T);
    } catch {
      // Ignore intermediate, non-integer input (e.g. while the user is still typing).
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
      <InputNumber<string>
        controls={false}
        style={{
          width: 140,
        }}
        stringMode
        precision={0}
        min={min != null ? min.toString() : undefined}
        max={max != null ? max.toString() : undefined}
        onChange={onChangeGuarded}
        value={value != null ? value.toString() : null}
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
        {label} {value != null ? value.toString() : "-"}
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
