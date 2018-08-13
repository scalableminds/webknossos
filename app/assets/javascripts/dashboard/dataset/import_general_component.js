// @flow

import * as React from "react";
import { Button, Input, Checkbox, Col, Row, Tooltip } from "antd";
import Clipboard from "clipboard-js";
import Toast from "libs/toast";
import TeamSelectionComponent from "dashboard/dataset/team_selection_component";
import { AsyncButton } from "components/async_clickables";
import { getDatasetSharingToken, revokeDatasetSharingToken } from "admin/admin_rest_api";
import { FormItemWithInfo } from "./helper_components";

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
    const doesNeedToken = !this.props.form.getFieldValue("dataset.isPublic");
    const tokenSuffix = `?token=${this.state.sharingToken}`;
    return `${window.location.origin}/datasets/${this.props.datasetName}/view${
      doesNeedToken ? tokenSuffix : ""
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
          label="Visibility"
          info="If checked, the dataset will be listed when unregistered users visit webKnossos."
        >
          {getFieldDecorator("dataset.isPublic", { valuePropName: "checked" })(
            <Checkbox>Make dataset publicly accessible </Checkbox>,
          )}
        </FormItemWithInfo>
        <FormItemWithInfo
          label="Sharing Link"
          info={
            <span>
              The sharing link can be used to allow unregistered users to view this dataset. If the
              dataset itself is not public, the link contains a secret token which ensures that the
              dataset can be opened if you know the special link.
            </span>
          }
        >
          <Input.Group compact>
            <Input
              value={this.getSharingLink()}
              onClick={this.handleSelectText}
              style={{ width: "80%" }}
              readOnly
            />
            <Button onClick={this.handleCopySharingLink} style={{ width: "10%" }} icon="copy">
              Copy
            </Button>
            {form.getFieldValue("dataset.isPublic") ? null : (
              <Tooltip
                title={
                  <span>
                    The URL contains a secret token which enables anybody with this link to view the
                    dataset. Renew the token to make the old link invalid.
                  </span>
                }
              >
                <AsyncButton
                  onClick={this.handleRevokeSharingLink}
                  style={{ width: "10%" }}
                  icon="retweet"
                >
                  Renew
                </AsyncButton>
              </Tooltip>
            )}
          </Input.Group>
        </FormItemWithInfo>
      </div>
    );

    return content;
  }
}
