// @flow

import * as React from "react";
import {
  Button,
  Icon,
  Input,
  Checkbox,
  Form,
  Col,
  Row,
  Tooltip,
} from "antd";
import Clipboard from "clipboard-js";
import Toast from "libs/toast";
import TeamSelectionComponent from "dashboard/dataset/team_selection_component";
import { FormItemWithInfo } from "./helper_components";

const FormItem = Form.Item;

const handleSelectText = (event: SyntheticInputEvent<>) => {
  event.target.select();
};

const handleCopySharingLink = async (sharingLink: string) => {
  await Clipboard.copy(sharingLink);
  Toast.success("Sharing Link copied to clipboard");
};

export default function ImportGeneralComponent({
  form,
  hasNoAllowedTeams,
  sharingLink,
  handleRevokeSharingLink,
  isEditingMode,
}: {
  form: Object,
  hasNoAllowedTeams: boolean,
  sharingLink: string,
  handleRevokeSharingLink: string => Promise<void>,
  isEditingMode: boolean,
}) {
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
  const content = !isEditingMode ? (
    allowedTeamsComponent
  ) : (
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
        label="Sharing Link"
        info="The sharing link can be used to allow unregistered users viewing this dataset."
      >
        <Input.Group compact>
          <Input value={sharingLink} onClick={handleSelectText} style={{ width: "80%" }} readOnly />
          <Button
            onClick={() => handleCopySharingLink(sharingLink)}
            style={{ width: "10%" }}
            icon="copy"
          />
          <Button onClick={handleRevokeSharingLink} style={{ width: "10%" }}>
            Revoke
          </Button>
        </Input.Group>
      </FormItemWithInfo>
      <FormItem>
        {getFieldDecorator("dataset.isPublic", { valuePropName: "checked" })(
          <Checkbox>
            Make dataset publicly accessible{" "}
            <Tooltip title="If checked, the dataset will be listed when unregistered users visit webKnossos.">
              <Icon type="info-circle-o" style={{ color: "gray" }} />
            </Tooltip>
          </Checkbox>,
        )}
      </FormItem>
    </div>
  );

  return content;
}
