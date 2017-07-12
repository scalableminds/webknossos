import React from "react";
import { Button, Spin, Input } from "antd";
import Request from "libs/request";
import Toast from "libs/toast";

class DatasetImportView extends React.PureComponent {

  props: {
    datasetName: string
  }

  state = {
    dataset: null,
    datasetJson: null,
    isValidJSON: true,
  }

  componentDidMount() {
    const datasetUrl = `/api/datasets/${this.props.datasetName}`;
    const dataset = Request.receiveJSON(datasetUrl).then((dataset) => {


      const datasetJsonUrl = `${dataset.dataStore.url}/data/datasets/${this.props.datasetName}`;
      const datasetJson = Request.receiveJSON(datasetJsonUrl).then((datasetJson) => {

        this.setState({
          dataset,
          datasetJson: JSON.stringify(datasetJson.dataSource, null, "  "),
        });
      });
    });
  }

  importDataset = () => {
    if (this.state.isValidJSON) {
      const url = `${this.state.dataset.dataStore.url}/data/datasets/${this.props.datasetName}`;
      Request.sendJSONReceiveJSON(url, {
        data: JSON.parse(this.state.datasetJson),
      }).then(
        () => {
          Toast.success(`Successfully imported ${this.props.datasetName}`);
          window.history.back();
        },
        (error) => {
          Toast.error(error);
        },
      );
    } else {
      Toast.error("Invalid JSON. Please fix the errors.");
    }
  }

  handleChangeJson = (el) => {
    try {
      JSON.parse(el.target.value);
      this.setState({
        datasetJson: el.target.value,
        isValidJSON: true,
      });
    } catch (e) {
      this.setState({
        datasetJson: el.target.value,
        isValidJSON: false,
      });
    }
  }

  render() {
    const datasetJson = this.state.datasetJson;
    const textAreaStyle = this.state.isValidJSON ? {
      fontFamily: "monospace",
    } : {
      fontFamily: "monospace",
      border: "1px solid red",
      boxShadow: "0 0 0 2px rgba(233, 16, 76, 0.28)",
    };

    const content = datasetJson ? (<Input.TextArea
      value={datasetJson}
      onChange={this.handleChangeJson}
      rows={20}
      style={textAreaStyle}
    />) :
    <Spin size="large" />;

    return (
      <div className="container" id="dataset-import-view">
        <h3>Import Dataset {this.props.datasetName}</h3>
        <div className="content">
          {content}
        </div>
        <div>
          <Button onClick={this.importDataset} type="primary">Import</Button>
          <Button onClick={() => window.history.back()}>Cancel</Button>
        </div>
      </div>
    );
  }
}

export default DatasetImportView;
