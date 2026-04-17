import { Col, Row, Switch } from "antd";
import FastTooltip from "components/fast_tooltip";
import {
  ANTD_TOTAL_SPAN,
  ROW_GUTTER,
  SETTING_LEFT_SPAN,
  SETTING_RIGHT_SPAN,
} from "viewer/view/left_border_tabs/components/setting_input_helper";

type SwitchSettingProps = React.PropsWithChildren<{
  onChange: (value: boolean) => void | Promise<void>;
  value: boolean;
  label: string | React.ReactNode;
  disabled?: boolean;
  tooltipText?: string | null | undefined;
  loading?: boolean;
  labelSpan?: number | null;
  postSwitchIcon?: React.ReactNode | null | undefined;
  disabledReason?: string | null;
}>;

export default function SwitchSetting(props: SwitchSettingProps) {
  const {
    label,
    onChange,
    value,
    disabled = false,
    tooltipText = null,
    loading = false,
    labelSpan = null,
    postSwitchIcon = null,
    disabledReason,
    children,
  } = props;

  const leftSpanValue = labelSpan || SETTING_LEFT_SPAN;
  const rightSpanValue = labelSpan != null ? ANTD_TOTAL_SPAN - leftSpanValue : SETTING_RIGHT_SPAN;
  return (
    <Row align="middle" gutter={ROW_GUTTER} style={{ marginBottom: "var(--ant-margin-sm)" }}>
      <Col span={leftSpanValue}>
        <label className="setting-label">{label}</label>
      </Col>
      <Col span={rightSpanValue}>
        <FastTooltip title={tooltipText} placement="top">
          {/* This div is necessary for the tooltip to be displayed */}
          <div
            style={{
              display: "inline-flex",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <FastTooltip title={disabledReason}>
              <Switch
                onChange={onChange}
                checked={value}
                defaultChecked={value}
                disabled={disabled}
                loading={loading}
              />
            </FastTooltip>
            {postSwitchIcon}
          </div>
        </FastTooltip>
        {children}
      </Col>
    </Row>
  );
}
