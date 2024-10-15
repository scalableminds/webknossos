import { Checkbox, Col, Collapse, Form, Input, Row, Table, Button, type CollapseProps } from "antd";
import type { FormInstance } from "antd/lib/form";
import * as React from "react";
import _ from "lodash";
import { jsonEditStyle } from "dashboard/dataset/helper_components";
import { jsonStringify } from "libs/utils";
import { settings, type RecommendedConfiguration } from "messages";
import { validateUserSettingsJSON } from "types/validation";
import { TDViewDisplayModeEnum } from "oxalis/constants";
import features from "features";
const FormItem = Form.Item;

function getRecommendedConfigByCategory() {
  return {
    orthogonal: {
      clippingDistance: 80,
      moveValue: 500,
      displayScalebars: false,
      newNodeNewTree: false,
      centerNewNode: true,
      tdViewDisplayPlanes: TDViewDisplayModeEnum.WIREFRAME,
      tdViewDisplayDatasetBorders: true,
      tdViewDisplayLayerBorders: false,
    },
    all: {
      dynamicSpaceDirection: true,
      highlightCommentedNodes: false,
      overrideNodeRadius: true,
      particleSize: 5,
      keyboardDelay: 0,
      displayCrosshair: true,
      useLegacyBindings: features().defaultToLegacyBindings || false,
    },
    dataset: {
      fourBit: false,
      interpolation: true,
      segmentationOpacity: 0,
      segmentationPatternOpacity: 40,
      zoom: 0.8,
      renderMissingDataBlack: false,
      loadingStrategy: "BEST_QUALITY_FIRST",
    },
    flight: {
      clippingDistanceArbitrary: 60,
      moveValue3d: 600,
      mouseRotateValue: 0.001,
      rotateValue: 0.01,
      sphericalCapRadius: 500,
    },
    volume: {
      brushSize: 50,
    },
  };
}

type RecommendedConfigurationByCategory = ReturnType<typeof getRecommendedConfigByCategory>;

export function getDefaultRecommendedConfiguration(): RecommendedConfiguration {
  const recommendedConfigByCategory = getRecommendedConfigByCategory();
  // @ts-expect-error ts-migrate(2322) FIXME: Type '{ brushSize: number; clippingDistanceArbitra... Remove this comment to see the full error message
  return {
    ...recommendedConfigByCategory.orthogonal,
    ...recommendedConfigByCategory.all,
    ...recommendedConfigByCategory.dataset,
    ...recommendedConfigByCategory.flight,
    ...recommendedConfigByCategory.volume,
  };
}
export const settingComments: Partial<Record<keyof RecommendedConfiguration, string>> = {
  clippingDistance: "orthogonal mode",
  moveValue: "orthogonal mode",
  clippingDistanceArbitrary: "flight/oblique mode",
  moveValue3d: "flight/oblique mode",
  loadingStrategy: "BEST_QUALITY_FIRST or PROGRESSIVE_QUALITY",
  tdViewDisplayPlanes: Object.values(TDViewDisplayModeEnum).join(" or "),
};
const columns = [
  {
    title: "Display Name",
    dataIndex: "name",
  },
  {
    title: "Key",
    dataIndex: "key",
  },
  {
    title: "Default Value",
    dataIndex: "value",
  },
  {
    title: "Comment",
    dataIndex: "comment",
  },
];

const removeSettings = (
  form: FormInstance,
  settingsKey: keyof RecommendedConfigurationByCategory,
) => {
  const settingsString = form.getFieldValue("recommendedConfiguration");

  try {
    const settingsObject = JSON.parse(settingsString);

    const newSettings = _.omit(
      settingsObject,
      Object.keys(getRecommendedConfigByCategory()[settingsKey]),
    );

    form.setFieldsValue({
      recommendedConfiguration: jsonStringify(newSettings),
    });
  } catch (e) {
    console.error(e);
  }
};

export default function RecommendedConfigurationView({
  form,
  enabled,
  onChangeEnabled,
}: {
  form: FormInstance;
  enabled: boolean;
  onChangeEnabled: (arg0: boolean) => void;
}) {
  const recommendedConfiguration = getDefaultRecommendedConfiguration();
  const configurationEntries = _.map(recommendedConfiguration, (_value: any, key: string) => {
    // @ts-ignore Typescript doesn't infer that key will be of type keyof RecommendedConfiguration
    const settingsKey: keyof RecommendedConfiguration = key;
    return {
      name: settings[settingsKey],
      key,
      // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
      value: recommendedConfiguration[settingsKey].toString(),
      comment: settingComments[settingsKey] || "",
    };
  });

  const recommendedSettingsView = (
    <Row gutter={32}>
      <Col span={12}>
        <div>
          The recommended configuration will be displayed to users when starting to work on a task
          with this task type. The user is able to accept or decline this recommendation.
          <br />
          <br />
          <FormItem
            name="recommendedConfiguration"
            hasFeedback
            rules={[
              {
                validator: (rule, value) =>
                  enabled ? validateUserSettingsJSON(rule, value) : Promise.resolve(),
              },
            ]}
          >
            <Input.TextArea
              spellCheck={false}
              autoSize={{
                minRows: 20,
              }}
              style={jsonEditStyle}
            />
          </FormItem>
        </div>
        <Button className="button-margin" onClick={() => removeSettings(form, "orthogonal")}>
          Remove Orthogonal-only Settings
        </Button>
        <Button className="button-margin" onClick={() => removeSettings(form, "flight")}>
          Remove Flight/Oblique-only Settings
        </Button>
        <Button className="button-margin" onClick={() => removeSettings(form, "volume")}>
          Remove Volume-only Settings
        </Button>
      </Col>
      <Col span={12}>
        Valid settings and their default values: <br />
        <br />
        <Table
          columns={columns}
          dataSource={configurationEntries}
          size="small"
          pagination={false}
          className="large-table"
          scroll={{
            x: "max-content",
          }}
        />
      </Col>
    </Row>
  );

  const collapseItems: CollapseProps["items"] = [
    {
      key: "config",
      label: (
        <React.Fragment>
          <Checkbox
            checked={enabled}
            style={{
              marginRight: 10,
            }}
          />{" "}
          Add Recommended User Settings
        </React.Fragment>
      ),
      showArrow: false,
      children: recommendedSettingsView,
    },
  ];

  return (
    <Collapse
      onChange={(openedPanels) => onChangeEnabled(openedPanels.length === 1)}
      activeKey={enabled ? "config" : undefined}
      items={collapseItems}
    />
  );
}
