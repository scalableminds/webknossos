import Icon from "@ant-design/icons";
import InvertIcon from "@images/icons/icon-invert.svg?react";
import { Col, Row } from "antd";
import classnames from "classnames";
import FastTooltip from "components/fast_tooltip";
import { rgbToHex } from "libs/utils";
import { layerViewConfigurations, layerViewConfigurationTooltips } from "messages";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import { getDefaultLayerViewConfiguration } from "types/schemas/dataset_view_configuration.schema";
import { updateLayerSettingAction } from "viewer/model/actions/settings_actions";
import type { DatasetLayerConfiguration } from "viewer/store";
import ButtonComponent from "viewer/view/components/button_component";
import {
  ColorSetting,
  LogSliderSetting,
  SETTING_LEFT_SPAN,
  SETTING_MIDDLE_SPAN,
  SETTING_VALUE_SPAN,
} from "viewer/view/components/setting_input_views";

export default function ColorLayerSettings({
  layerName,
  layerConfiguration,
}: {
  layerName: string;
  layerConfiguration: DatasetLayerConfiguration;
}) {
  const dispatch = useDispatch();
  const defaultSettings = getDefaultLayerViewConfiguration();

  const onChangeLayer = useCallback(
    (propertyName: keyof DatasetLayerConfiguration, value: any) => {
      dispatch(updateLayerSettingAction(layerName, propertyName, value));
    },
    [dispatch, layerName],
  );

  const onChangeGamma = useCallback(
    (value: number) => onChangeLayer("gammaCorrectionValue", value),
    [onChangeLayer],
  );

  const onChangeColor = useCallback((value: any) => onChangeLayer("color", value), [onChangeLayer]);

  const onToggleInvert = useCallback(
    () => onChangeLayer("isInverted", layerConfiguration ? !layerConfiguration.isInverted : false),
    [onChangeLayer, layerConfiguration],
  );

  return (
    <div>
      <LogSliderSetting
        label={
          <FastTooltip title={layerViewConfigurationTooltips.gammaCorrectionValue}>
            {layerViewConfigurations.gammaCorrectionValue}
          </FastTooltip>
        }
        min={0.01}
        max={10}
        roundToDigit={3}
        value={layerConfiguration.gammaCorrectionValue}
        onChange={onChangeGamma}
        defaultValue={defaultSettings.gammaCorrectionValue}
      />
      <Row
        style={{
          marginBottom: "var(--ant-margin-sm)",
          marginTop: 6,
        }}
      >
        <Col span={SETTING_LEFT_SPAN}>
          <label className="setting-label">Color</label>
        </Col>
        <Col span={SETTING_MIDDLE_SPAN}>
          <ColorSetting
            value={rgbToHex(layerConfiguration.color)}
            onChange={onChangeColor}
            style={{
              marginLeft: 6,
            }}
          />
        </Col>
        <Col span={SETTING_VALUE_SPAN}>
          <ButtonComponent
            variant="text"
            color="default"
            size="small"
            title="Invert the color of this layer."
            onClick={onToggleInvert}
            icon={
              <Icon
                component={InvertIcon}
                className={classnames({
                  "flip-horizontally": layerConfiguration.isInverted,
                })}
                style={{
                  margin: 0,
                  transition: "transform 0.5s ease 0s",
                  color: layerConfiguration.isInverted ? "var(--ant-color-primary)" : undefined,
                }}
              />
            }
            style={{
              marginLeft: 10,
            }}
          />
        </Col>
      </Row>
    </div>
  );
}
