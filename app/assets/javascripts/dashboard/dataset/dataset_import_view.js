// @flow

import * as React from "react";
import { Button, Spin, Input, Checkbox, Alert, Form, Card } from "antd";
import Clipboard from "clipboard-js";
import update from "immutability-helper";
import Toast from "libs/toast";
import {
  getDatasetSharingToken,
  revokeDatasetSharingToken,
  getDataset,
  getDatasetDatasource,
  updateDataset,
  updateDatasetDatasource,
} from "admin/admin_rest_api";
import messages from "messages";
import type { APIDatasetType, APIMessageType } from "admin/api_flow_types";

const FormItem = Form.Item;

type Props = {
  datasetName: string,
  isEditingMode: boolean,
};

type State = {
  dataLoaded: boolean,
  dataset: ?APIDatasetType,
  sharingToken: string,
  datasetJson: string,
  isValidJSON: boolean,
  messages: Array<APIMessageType>,
  isLoading: boolean,
};

class DatasetImportView extends React.PureComponent<Props, State> {
  static defaultProps: Props = {
    datasetName: "",
    isEditingMode: false,
  };

  state = {
    dataLoaded: false,
    dataset: null,
    sharingToken: "",
    isLoading: false,
    datasetJson: "",
    isValidJSON: true,
    messages: [],
  };

  componentDidMount() {
    this.fetchData().then(
      _ => this.setState({ dataLoaded: true }),
      _ => this.setState({ dataLoaded: true }),
    );
  }

  async fetchData(): Promise<void> {
    this.setState({ isLoading: true });
    const sharingToken = await getDatasetSharingToken(this.props.datasetName);
    const dataset = await getDataset(this.props.datasetName);
    const { dataSource, messages: dataSourceMessages } = await getDatasetDatasource(dataset);

    // eslint-disable-next-line react/no-did-mount-set-state
    this.setState({
      dataLoaded: true,
      sharingToken,
      dataset,
      datasetJson: JSON.stringify(dataSource, null, "  "),
      messages: dataSourceMessages,
      isLoading: false,
    });
  }

  importDataset = async () => {
    if (this.props.isEditingMode && this.state.dataset != null) {
      await updateDataset(this.props.datasetName, this.state.dataset);
    }

    if (this.state.isValidJSON && this.state.dataset != null) {
      await updateDatasetDatasource(
        this.props.datasetName,
        this.state.dataset.dataStore.url,
        JSON.parse(this.state.datasetJson),
      );
      Toast.success(`Successfully imported ${this.props.datasetName}`);
      window.history.back();
    } else {
      Toast.error("Invalid JSON. Please fix the errors.");
    }
  };

  handleChangeJson = (event: SyntheticInputEvent<>) => {
    try {
      JSON.parse(event.target.value);
      this.setState({
        datasetJson: event.target.value,
        isValidJSON: true,
      });
    } catch (e) {
      this.setState({
        datasetJson: event.target.value,
        isValidJSON: false,
      });
    }
  };

  handleChangeDescription = (event: SyntheticInputEvent<>) => {
    this.updateDataset("description", event.target.value);
  };

  handleChangeCheckbox = (event: SyntheticInputEvent<>) => {
    this.updateDataset("isPublic", event.target.checked);
  };

  handleCopySharingLink = async () => {
    await Clipboard.copy(this.getSharingLink());
    Toast.success("Sharing Link copied to clipboard");
  };

  handleRevokeSharingLink = async () => {
    this.setState({ isLoading: true });
    try {
      await revokeDatasetSharingToken(this.props.datasetName);
      const sharingToken = await getDatasetSharingToken(this.props.datasetName);
      this.setState({ sharingToken });
    } finally {
      this.setState({ isLoading: false });
    }
  };

  handleSelectText = (event: SyntheticInputEvent<>) => {
    event.target.select();
  };

  updateDataset(propertyName: string, value: string | boolean) {
    const newState = update(this.state, {
      dataset: { [propertyName]: { $set: value } },
    });
    this.setState(newState);
  }

  getSharingLink() {
    return `${window.location.origin}/datasets/${this.props.datasetName}/view?token=${
      this.state.sharingToken
    }`;
  }

  getMessageComponents() {
    const messageElements = this.state.messages.map((message, i) => (
      // eslint-disable-next-line react/no-array-index-key
      <Alert key={i} message={Object.values(message)[0]} type={Object.keys(message)[0]} showIcon />
    ));

    if (this.state.dataset != null && this.state.dataset.dataSource.status != null) {
      const statusMessage = (
        <span>
          {messages["dataset.invalid_datasource_json"]}
          <br />
          {this.state.dataset.dataSource.status}
        </span>
      );
      messageElements.push(
        <Alert key="datasourceStatus" message={statusMessage} type="error" showIcon />,
      );
    }

    return <div>{messageElements}</div>;
  }

  getEditModeComponents() {
    // these components are only available in editing mode
    if (this.props.isEditing && this.state.dataset != null) {
      const { dataset } = this.state;

      return (
        <div>
          <FormItem label="Dataset Description">
            <Input.TextArea
              rows="3"
              value={dataset.description || ""}
              placeholder="Dataset Description"
              onChange={this.handleChangeDescription}
            />
          </FormItem>
          <FormItem label="Sharing Link">
            <Input.Group compact>
              <Input
                value={this.getSharingLink()}
                onClick={this.handleSelectText}
                style={{ width: "80%" }}
                readOnly
              />
              <Button onClick={this.handleCopySharingLink} style={{ width: "10%" }} icon="copy" />
              <Button onClick={this.handleRevokeSharingLink} style={{ width: "10%" }}>
                Revoke
              </Button>
            </Input.Group>
          </FormItem>
          <FormItem>
            <Checkbox checked={dataset.isPublic} onChange={this.handleChangeCheckbox}>
              Make dataset publicly accessible
            </Checkbox>
          </FormItem>
        </div>
      );
    }

    return <span />;
  }

  render() {
    const { datasetJson } = this.state;
    const textAreaStyle = this.state.isValidJSON
      ? {
          fontFamily: "monospace",
        }
      : {
          fontFamily: "monospace",
          border: "1px solid red",
          boxShadow: "0 0 0 2px rgba(233, 16, 76, 0.28)",
        };

    const titleString = this.props.isEditingMode ? "Update" : "Import";
    const content = this.state.dataLoaded ? (
      <FormItem label="Dataset Configuration">
        <Input.TextArea
          value={datasetJson}
          onChange={this.handleChangeJson}
          rows={20}
          style={textAreaStyle}
        />
      </FormItem>
    ) : null;

    return (
      <div className="row container dataset-import">
        <Card
          title={
            <h3>
              {titleString} Dataset: {this.props.datasetName}
            </h3>
          }
        >
          <Spin size="large" spinning={this.state.isLoading}>
            <p>Please review your dataset&#39;s properties before importing it.</p>
            {this.getMessageComponents()}
            {content}
            {this.getEditModeComponents()}
            <FormItem>
              <Button
                onClick={this.importDataset}
                type="primary"
                disabled={this.state.datasetJson === ""}
              >
                {titleString}
              </Button>&nbsp;
              <Button onClick={() => window.history.back()}>Cancel</Button>
            </FormItem>
          </Spin>
        </Card>
      </div>
    );
  }
}

export default DatasetImportView;
