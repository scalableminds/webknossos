// @flow

import { Input, Col, Row, DatePicker } from "antd";
import React from "react";

import type { APIDataset, APIDatasetId } from "admin/api_flow_types";
import TeamSelectionComponent from "dashboard/dataset/team_selection_component";

import { FormItemWithInfo } from "./helper_components";

type Props = {
  form: Object,
  hasNoAllowedTeams: boolean,
};

export default function ImportGeneralComponent({ form, hasNoAllowedTeams }: Props) {
  const { getFieldDecorator } = form;

  const allowedTeamsComponent = (
    <FormItemWithInfo
      label="Allowed Teams"
      info="Except for administrators and team managers, only members of the teams defined here will be able to view this dataset."
      validateStatus={hasNoAllowedTeams ? "warning" : "success"}
      help={
        hasNoAllowedTeams
          ? "If this field is empty, only administrators and team managers will be able to view this dataset."
          : null
      }
    >
      {getFieldDecorator("dataset.allowedTeams", {})(<TeamSelectionComponent mode="multiple" />)}
    </FormItemWithInfo>
  );
  return (
    <div>
      <Row gutter={48}>
        <Col span={12}>
          <FormItemWithInfo
            label="Display Name"
            info="The display name will be used by webKnossos to name this dataset. If the display name is not provided, the original name will be used."
          >
            {getFieldDecorator("dataset.displayName")(<Input placeholder="Display Name" />)}
          </FormItemWithInfo>
        </Col>
        <Col span={12}>
          <FormItemWithInfo
            label="Description"
            info="The description may contain additional information about your dataset."
          >
            {getFieldDecorator("dataset.description")(
              <Input.TextArea rows="3" placeholder="Description" />,
            )}
          </FormItemWithInfo>
        </Col>
      </Row>
      {allowedTeamsComponent}
      <FormItemWithInfo
        label="Sorting Date"
        info="This date can be used to sort the datasets within webKnossos. For example, if the dataset was published in a paper, you can input the publication date of the paper here."
      >
        {getFieldDecorator("dataset.sortingKey")(
          <DatePicker placeholder="Select a Publication Date" />,
        )}
      </FormItemWithInfo>
    </div>
  );
}
