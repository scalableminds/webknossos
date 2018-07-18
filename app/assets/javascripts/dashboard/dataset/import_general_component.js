// @flow

import * as React from "react";
import { Button, Icon, Input, Checkbox, Form, Col, Row, Tooltip } from "antd";
import Clipboard from "clipboard-js";
import Toast from "libs/toast";
import TeamSelectionComponent from "dashboard/dataset/team_selection_component";
import { AsyncButton } from "components/async_clickables";
import { getDatasetSharingToken, revokeDatasetSharingToken } from "admin/admin_rest_api";
import { FormItemWithInfo } from "./helper_components";

const FormItem = Form.Item;

type Props = {
  form: Object,
  datasetName: string,
  hasNoAllowedTeams: boolean,
};

type State = {
  sharingToken: string,
};

export default class ImportGeneralComponent extends React.PureComponent<Props, State> {
  constructor() {
    super();
    this.state = {
      sharingToken: "",
    };
  }
  componentDidMount() {
    this.fetch();
  }

  async fetch() {
    const sharingToken = await getDatasetSharingToken(this.props.datasetName);
    this.setState({ sharingToken });
  }

  handleSelectText(event: SyntheticInputEvent<>): void {
    event.target.select();
  }

  handleCopySharingLink = async (): Promise<void> => {
    await Clipboard.copy(this.getSharingLink());
    Toast.success("Sharing Link copied to clipboard");
  };

  handleRevokeSharingLink = async (): Promise<void> => {
    const { datasetName } = this.props;
    await revokeDatasetSharingToken(datasetName);
    const sharingToken = await getDatasetSharingToken(datasetName);
    this.setState({ sharingToken });
  };

  getSharingLink() {
    return `${window.location.origin}/datasets/${this.props.datasetName}/view?token=${
      this.state.sharingToken
    }`;
  }

  render() {
    const { form, hasNoAllowedTeams } = this.props;
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
    const content = (
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
          info="The sharing link can be used to allow unregistered users to view this dataset."
        >
          <Input.Group compact>
            <Input
              value={this.getSharingLink()}
              onClick={this.handleSelectText}
              style={{ width: "80%" }}
              readOnly
            />
            <Button onClick={this.handleCopySharingLink} style={{ width: "10%" }} icon="copy" />
            <AsyncButton onClick={this.handleRevokeSharingLink} style={{ width: "10%" }}>
              Revoke
            </AsyncButton>
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
}
