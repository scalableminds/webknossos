import { Col, InputNumber, Row } from "antd";
import { Slider } from "components/slider";
import { roundTo } from "libs/utils";
import type { Vector3 } from "viewer/constants";
import {
  ROW_GUTTER,
  SETTING_LEFT_SPAN,
  SETTING_MIDDLE_SPAN,
  SETTING_VALUE_SPAN,
} from "viewer/view/left_border_tabs/components/setting_input_helper";

type LogSliderSettingProps = {
  onChange: (value: number) => void;
  value: number;
  label: string | React.ReactNode;
  max: number;
  min: number;
  roundToDigit: number;
  disabled?: boolean;
  spans?: Vector3;
  precision?: number;
  defaultValue?: number;
};

const LOG_SLIDER_MIN = -100;
const LOG_SLIDER_MAX = 100;

export function LogSliderSetting(props: LogSliderSettingProps) {
  const {
    onChange,
    value,
    label,
    max,
    min,
    roundToDigit = 3,
    disabled = false,
    spans = [SETTING_LEFT_SPAN, SETTING_MIDDLE_SPAN, SETTING_VALUE_SPAN],
    precision,
    defaultValue,
  } = props;

  const onChangeInput = (inputValue: number | null) => {
    if (inputValue == null) {
      return;
    }
    if (min <= inputValue && inputValue <= max) {
      onChange(inputValue);
    } else {
      // reset to slider value
      onChange(value);
    }
  };
  const onChangeSlider = (sliderValue: number) => {
    onChange(calculateValue(sliderValue));
  };
  const calculateValue = (sliderValue: number) => {
    const a = 200 / (Math.log(max) - Math.log(min));
    const b = (100 * (Math.log(min) + Math.log(max))) / (Math.log(min) - Math.log(max));
    return Math.exp((sliderValue - b) / a);
  };

  const formatTooltip = (tooltipValue: number | undefined) => {
    if (tooltipValue == null) {
      return "invalid";
    }
    const calculatedValue = calculateValue(tooltipValue);
    return calculatedValue >= 10000
      ? calculatedValue.toExponential()
      : roundTo(calculatedValue, roundToDigit);
  };

  const getSliderValue = () => {
    const a = 200 / (Math.log(max) - Math.log(min));
    const b = (100 * (Math.log(min) + Math.log(max))) / (Math.log(min) - Math.log(max));
    const scaleValue = a * Math.log(value) + b;
    return Math.round(scaleValue);
  };

  const resetToDefaultValue = () => {
    if (defaultValue == null) return;
    onChangeInput(defaultValue);
  };

  return (
    <Row align="middle" gutter={ROW_GUTTER}>
      <Col span={spans[0]}>
        <label className="setting-label">{label}</label>
      </Col>
      <Col span={spans[1]}>
        <Slider
          min={LOG_SLIDER_MIN}
          max={LOG_SLIDER_MAX}
          tooltip={{ formatter: formatTooltip }}
          onChange={onChangeSlider}
          value={getSliderValue()}
          disabled={disabled}
          defaultValue={defaultValue}
          onResetToDefault={resetToDefaultValue}
        />
      </Col>
      <Col span={spans[2]}>
        <InputNumber
          controls={false}
          variant={"borderless"}
          min={min}
          max={max}
          style={{
            width: "100%",
          }}
          step={value / 10}
          precision={precision ?? 2}
          value={roundToDigit != null ? roundTo(value, roundToDigit) : value}
          onChange={onChangeInput}
          disabled={disabled}
          size="small"
        />
      </Col>
    </Row>
  );
}
