// @flow

import * as React from "react";
import { Button, Spin, Input, Checkbox, Alert, Form, Card } from "antd";
import Clipboard from "clipboard-js";
import Request from "libs/request";
import update from "immutability-helper";
import Toast from "libs/toast";
import {
  doWithToken,
  getDatasetSharingToken,
  revokeDatasetSharingToken,
  getDataset,
} from "admin/admin_rest_api";
import type { APIDatasetType } from "admin/api_flow_types";

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
  isLoading: boolean,
  messages: Array<{ ["info" | "warning" | "error"]: string }>,
};

class DatasetImportView extends React.PureComponent<Props, State> {
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

  props: {
    datasetName: string,
    isEditingMode: boolean,
  } = {
    datasetName: "",
    isEditingMode: false,
  };

  async fetchData(): Promise<void> {
    this.setState({ isLoading: true });
    const sharingToken = await getDatasetSharingToken(this.props.datasetName);
    const dataset = await getDataset(this.props.datasetName);

    const datasetJson = await doWithToken(token =>
      Request.receiveJSON(
        `${dataset.dataStore.url}/data/datasets/${this.props.datasetName}?token=${token}`,
      ),
    );

    // eslint-disable-next-line react/no-did-mount-set-state
    this.setState({
      dataLoaded: true,
      sharingToken,
      dataset,
      datasetJson: JSON.stringify(datasetJson.dataSource, null, "  "),
      messages: datasetJson.messages,
      isLoading: false,
    });
  }

  importDataset = () => {
    if (this.props.isEditingMode) {
      const url = `/api/datasets/${this.props.datasetName}`;
      Request.sendJSONReceiveJSON(url, {
        data: this.state.dataset,
      });
    }

    if (this.state.isValidJSON && this.state.dataset) {
      // Make flow happy
      const nonNullDataset = this.state.dataset;
      doWithToken(token =>
        Request.sendJSONReceiveJSON(
          `${nonNullDataset.dataStore.url}/data/datasets/${this.props.datasetName}?token=${token}`,
          {
            data: JSON.parse(this.state.datasetJson),
          },
        ),
      ).then(() => {
        Toast.success(`Successfully imported ${this.props.datasetName}`);
        window.history.back();
      });
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

    return <div>{messageElements}</div>;
  }

  getEditModeComponents() {
    // these components are only available in editing mode
    if (this.state.dataset) {
      const dataset = this.state.dataset;

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
    const datasetJson = this.state.datasetJson;
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
