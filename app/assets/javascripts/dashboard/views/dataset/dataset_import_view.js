import React from "react";
import JsonEdit from 'react-jsoneditor'
import { Button, Spin } from "antd";
import Request from "libs/request";
import Toast from "libs/toast";

class DatasetImportView extends React.PureComponent {

  props: {
    datasetName: string
  }

  state = {
    dataset: null,
    datasetJson: null,
  }

  componentDidMount() {
    const datasetUrl = `/api/datasets/${this.props.datasetName}`;
    const dataset = Request.receiveJSON(datasetUrl).then((dataset) => {


      const datasetJsonUrl = `${dataset.dataStore.url}/data/datasets/${this.props.datasetName}`;
      const datasetJson = Request.receiveJSON(datasetJsonUrl).then((datasetJson) => {

        this.setState({
          dataset,
          datasetJson: datasetJson.dataSource,
        });
      });
    });
  }

  importDataset = () => {
    const url = `${this.state.dataset.dataStore.url}/data/datasets/${this.props.datasetName}`;
    Request.sendJSONReceiveJSON(url, {
      data: this.state.datasetJson,
    }).then(
      () => Toast.success(`Successfully imported ${this.props.datasetName}`),
      (error) => {
        Toast.error(error);
      },
    );
  }

  handleChangeJson = (newJson) => {
    debugger
    this.setState({
      datasetJson: newJson,
    });
  }

  render() {
    const datasetJson = this.state.datasetJson;
    // const content = datasetJson ? (<JsonEdit
    //   json={{"as": 1  }}
    //   changeVal={this.handleChangeJson}
    // />) : <Spin size="large" />;
    console.log(datasetJson)

    return (
      <div>
        <h3>Import Dataset {this.props.datasetName}</h3>
        <JsonEdit

        />
        <Button onClick={this.importDataset}>Import</Button>
        <Button onClick={() => window.history.back()}>Cancel</Button>
      </div>
    );
  }
}

export default DatasetImportView;
