import { Col, InputNumber, Row } from "antd";
import { Slider } from "components/slider";
import { isNumber } from "lodash-es";
import type { Vector3, Vector4 } from "viewer/constants";
import {
  ROW_GUTTER,
  SETTING_LEFT_SPAN,
  SETTING_MIDDLE_SPAN,
  SETTING_VALUE_SPAN,
} from "viewer/view/left_border_tabs/components/setting_input_helper";

type NumberSliderSettingProps = {
  onChange: (value: number) => void;
  value: number;
  label: string | React.ReactNode;
  max: number;
  min?: number;
  step?: number;
  disabled?: boolean;
  spans?: Vector3 | Vector4;
  defaultValue?: number;
  wheelFactor?: number;
  postComponent?: React.ReactNode;
};

export default function NumberSliderSetting({
  value: originalValue,
  label,
  max,
  min = 1,
  step = 1,
  onChange,
  disabled = false,
  defaultValue,
  wheelFactor: stepSize,
  spans = [SETTING_LEFT_SPAN, SETTING_MIDDLE_SPAN, SETTING_VALUE_SPAN],
  postComponent,
}: NumberSliderSettingProps) {
  const maybeCorrectedSpans =
    postComponent != null && spans.length < 4
      ? [spans[0] - 1, spans[1] - 1, spans[2] - 1, 3]
      : spans;

  const isValueValid = (_value: number | null) =>
    isNumber(_value) && _value >= min && _value <= max;

  const _onChange = (_value: number | null) => {
    if (_value != null && isValueValid(_value)) {
      onChange(_value);
    }
  };

  // Validate the provided value. If it's not valid, fallback to the midpoint between min and max.
  // This check guards against broken settings which could be introduced before this component
  // checked more thoroughly against invalid values.
  const value = isValueValid(originalValue) ? originalValue : Math.floor((min + max) / 2);
  return (
    <Row align="middle" gutter={ROW_GUTTER}>
      <Col span={maybeCorrectedSpans[0]}>
        <label className="setting-label">{label}</label>
      </Col>
      <Col span={maybeCorrectedSpans[1]}>
        <Slider
          min={min}
          max={max}
          onChange={onChange}
          value={value}
          step={step}
          disabled={disabled}
          defaultValue={defaultValue}
          wheelFactor={stepSize}
        />
      </Col>
      <Col span={maybeCorrectedSpans[2]}>
        <InputNumber
          controls={false}
          min={min}
          max={max}
          style={{
            width: "100%",
          }}
          value={value}
          onChange={_onChange}
          size="small"
          disabled={disabled}
          variant="borderless"
        />
      </Col>
      {postComponent ? <Col span={maybeCorrectedSpans[3]}>{postComponent}</Col> : null}
    </Row>
  );
}
