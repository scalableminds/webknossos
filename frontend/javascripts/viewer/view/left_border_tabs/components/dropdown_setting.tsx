import { Col, Row, Select } from "antd";
import FastTooltip from "components/fast_tooltip";
import {
  ROW_GUTTER,
  SETTING_LEFT_SPAN,
  SETTING_RIGHT_SPAN,
} from "viewer/view/left_border_tabs/components/setting_input_helper";

type DropdownSettingProps = {
  onChange: (value: number) => void;
  label: React.ReactNode | string;
  value: number | string;
  options: Array<Record<string, any>>;
  disabled?: boolean;
  disabledReason?: string | null;
};

export function DropdownSetting(props: DropdownSettingProps) {
  const { onChange, label, value, options, disabled, disabledReason } = props;
  return (
    <Row align="top" gutter={ROW_GUTTER} style={{ marginBottom: "var(--ant-margin-sm)" }}>
      <Col span={SETTING_LEFT_SPAN}>
        <label className="setting-label">{label}</label>
      </Col>
      <Col span={SETTING_RIGHT_SPAN}>
        <FastTooltip title={disabledReason}>
          <Select
            onChange={onChange}
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
            value={value.toString()}
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
            defaultValue={value.toString()}
            size="small"
            popupMatchSelectWidth={false}
            options={options}
            disabled={disabled}
          />
        </FastTooltip>
      </Col>
    </Row>
  );
}
