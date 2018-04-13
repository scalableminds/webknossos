// @flow

import * as React from "react";
import { Button, Spin, Input, Checkbox, Alert } from "antd";
import update from "immutability-helper";
import Toast from "libs/toast";
import {
  getDataset,
  getDatasetDatasource,
  updateDataset,
  updateDatasetDatasource,
} from "admin/admin_rest_api";
import messages from "messages";
import type { APIDatasetType, APIMessageType } from "admin/api_flow_types";

type Props = {
  datasetName: string,
  isEditingMode: boolean,
};

type State = {
  dataLoaded: boolean,
  dataset: ?APIDatasetType,
  datasetJson: string,
  isValidJSON: boolean,
  messages: Array<APIMessageType>,
};

class DatasetImportView extends React.PureComponent<Props, State> {
  static defaultProps: Props = {
    datasetName: "",
    isEditingMode: false,
  };

  state = {
    dataLoaded: false,
    dataset: null,
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
    const dataset = await getDataset(this.props.datasetName);
    const { dataSource, messages: dataSourceMessages } = await getDatasetDatasource(dataset);

    // eslint-disable-next-line react/no-did-mount-set-state
    this.setState({
      dataLoaded: true,
      dataset,
      datasetJson: JSON.stringify(dataSource, null, "  "),
      messages: dataSourceMessages,
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

  updateDataset(propertyName: string, value: string | boolean) {
    const newState = update(this.state, {
      dataset: { [propertyName]: { $set: value } },
    });
    this.setState(newState);
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
    if (this.props.isEditingMode && this.state.dataset != null) {
      const { dataset } = this.state;

      return (
        <div>
          <Input.TextArea
            rows="3"
            value={dataset.description || ""}
            placeholder="Dataset Description"
            onChange={this.handleChangeDescription}
          />
          <Checkbox checked={dataset.isPublic} onChange={this.handleChangeCheckbox}>
            Make dataset publicly accessible
          </Checkbox>
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
      <Input.TextArea
        value={datasetJson}
        onChange={this.handleChangeJson}
        rows={20}
        style={textAreaStyle}
      />
    ) : (
      <Spin size="large" />
    );

    return (
      <div className="container" id="dataset-import-view">
        <h3>
          {titleString} Dataset {this.props.datasetName}
        </h3>
        <p>Please review your dataset&#39;s properties before importing it.</p>
        {this.getMessageComponents()}
        <div className="content">{content}</div>
        {this.getEditModeComponents()}
        <div>
          <Button
            onClick={this.importDataset}
            type="primary"
            disabled={this.state.datasetJson === ""}
          >
            {titleString}
          </Button>
          <Button onClick={() => window.history.back()}>Cancel</Button>
        </div>
      </div>
    );
  }
}

export default DatasetImportView;
