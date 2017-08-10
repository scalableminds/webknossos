// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import React from "react";
import Request from "libs/request";
import { Spin, Input, Table, Button, Upload } from "antd";
import type { APIAnnotationType } from "admin/api_flow_types";
import FormatUtils from "libs/format_utils";
import Toast from "libs/toast";
import Utils from "libs/utils";
import update from "immutability-helper";
import app from "app";
import EditableTextLabel from "oxalis/view/components/editable_text_label";

const { Column } = Table;
const { Search } = Input;

type Props = {
  userID: ?string,
  isAdminView: boolean,
};

export default class ExplorativeAnnotationsView extends React.PureComponent {
  props: Props;
  state: {
    shouldShowArchivedTracings: boolean,
    archivedTracings: Array<APIAnnotationType>,
    unarchivedTracings: Array<APIAnnotationType>,
    didAlreadyFetchMetaInfo: {
      isArchived: boolean,
      isUnarchived: boolean,
    },
    searchQuery: string,
    requestCount: number,
    isUploadingNML: boolean,
  } = {
    shouldShowArchivedTracings: false,
    archivedTracings: [],
    unarchivedTracings: [],
    didAlreadyFetchMetaInfo: {
      isArchived: false,
      isUnarchived: false,
    },
    searchQuery: "",
    requestCount: 0,
    isUploadingNML: false,
  };

  componentDidMount() {
    this.fetchDataMaybe();
  }

  isFetchNecessary(): boolean {
    const accessor = this.state.shouldShowArchivedTracings ? "isArchived" : "isUnarchived";
    return !this.state.didAlreadyFetchMetaInfo[accessor];
  }

  enterRequest() {
    this.setState({ requestCount: this.state.requestCount + 1 });
  }

  leaveRequest() {
    this.setState({ requestCount: this.state.requestCount - 1 });
  }

  async fetchDataMaybe(): Promise<void> {
    if (!this.isFetchNecessary()) {
      return;
    }

    const isFinishedString = this.state.shouldShowArchivedTracings.toString();
    const url = this.props.userID
      ? `/api/users/${this.props.userID}/annotations?isFinished=${isFinishedString}`
      : `/api/user/annotations?isFinished=${isFinishedString}`;

    this.enterRequest();
    const tracings = await Request.receiveJSON(url);
    this.leaveRequest();
    if (this.state.shouldShowArchivedTracings) {
      this.setState(
        update(this.state, {
          archivedTracings: { $set: tracings },
          didAlreadyFetchMetaInfo: {
            isArchived: { $set: true },
          },
        }),
      );
    } else {
      this.setState(
        update(this.state, {
          unarchivedTracings: { $set: tracings },
          didAlreadyFetchMetaInfo: {
            isUnarchived: { $set: true },
          },
        }),
      );
    }
  }

  toggleShowArchived = () => {
    this.setState({ shouldShowArchivedTracings: !this.state.shouldShowArchivedTracings });
    this.fetchDataMaybe();
  };

  finishOrReopenTracing = (type: "finish" | "reopen", tracing: APIAnnotationType) => {
    const controller = jsRoutes.controllers.AnnotationController;
    const url =
      type === "finish"
        ? controller.finish(tracing.typ, tracing.id).url
        : controller.reopen(tracing.typ, tracing.id).url;

    Request.receiveJSON(url).then(newTracing => {
      Toast.message(newTracing.messages);

      const newTracings = this.getCurrentTracings().filter(t => t.id !== tracing.id);

      if (type === "finish") {
        this.setState({
          unarchivedTracings: newTracings,
          archivedTracings: [newTracing].concat(this.state.archivedTracings),
        });
      } else {
        this.setState({
          archivedTracings: newTracings,
          unarchivedTracings: [newTracing].concat(this.state.unarchivedTracings),
        });
      }
    });
  };

  handleNMLUpload = (info: {
    file: { response: Object, status: "uploading" | "error" | "done" },
    fileList: Array<Object>,
    event: SyntheticInputEvent,
  }) => {
    const response = info.file.response;
    if (info.file.status === "uploading") {
      this.setState({ isUploadingNML: true });
    }
    if (info.file.status === "error") {
      response.messages.map(m => Toast.error(m.error));
    }
    if (info.file.status === "done") {
      response.messages.map(m => Toast.success(m.success));
      app.router.navigate(`/annotations/${response.annotation.typ}/${response.annotation.id}`, {
        trigger: true,
      });
    }
  };

  renderActions = (tracing: APIAnnotationType) => {
    if (tracing.typ !== "Explorational") {
      return null;
    }

    const controller = jsRoutes.controllers.AnnotationController;
    const { typ, id } = tracing;
    if (!this.state.shouldShowArchivedTracings) {
      return (
        <div>
          <a href={controller.trace(typ, id).url}>
            <i className="fa fa-random" />
            <strong>Trace</strong>
          </a>
          <br />
          <a href={jsRoutes.controllers.AnnotationIOController.download(typ, id).url}>
            <i className="fa fa-download" />
            Download
          </a>
          <br />
          <a href="#" onClick={() => this.finishOrReopenTracing("finish", tracing)}>
            <i className="fa fa-archive" />
            Archive
          </a>
          <br />
        </div>
      );
    } else {
      return (
        <div>
          <a href="#" onClick={() => this.finishOrReopenTracing("reopen", tracing)}>
            <i className="fa fa-folder-open" />
            reopen
          </a>
          <br />
        </div>
      );
    }
  };

  getCurrentTracings(): Array<APIAnnotationType> {
    return this.state.shouldShowArchivedTracings
      ? this.state.archivedTracings
      : this.state.unarchivedTracings;
  }

  handleSearch = (event: SyntheticInputEvent): void => {
    this.setState({ searchQuery: event.target.value });
  };

  renameTracing(tracing: APIAnnotationType, name: string) {
    const tracings = this.getCurrentTracings();

    const newTracings = tracings.map(currentTracing => {
      if (currentTracing.id !== tracing.id) {
        return currentTracing;
      } else {
        return update(currentTracing, { name: { $set: name } });
      }
    });

    this.setState({
      [this.state.shouldShowArchivedTracings
        ? "archivedTracings"
        : "unarchivedTracings"]: newTracings,
    });

    const url = `/annotations/${tracing.typ}/${tracing.id}/name`;
    const payload = { data: { name } };

    Request.sendJSONReceiveJSON(url, payload).then(response => {
      Toast.message(response.messages);
    });
  }

  archiveAll = () => {
    if (!confirm("Are you sure you want to archive all explorative annotations?")) {
      return;
    }

    const unarchivedAnnoationIds = this.state.unarchivedTracings.map(t => t.id);
    Request.sendJSONReceiveJSON(
      jsRoutes.controllers.AnnotationController.finishAll("Explorational").url,
      {
        method: "POST",
        data: {
          annotations: unarchivedAnnoationIds,
        },
      },
    ).then(data => {
      Toast.message(data.messages);

      this.setState({
        archivedTracings: this.state.unarchivedTracings.concat(this.state.archivedTracings),
        unarchivedTracings: [],
      });
    });
  };

  renderTable() {
    return (
      <Table
        dataSource={Utils.filterWithSearchQuery(
          this.getCurrentTracings(),
          ["id", "name", "dataSetName", "contentType"],
          this.state.searchQuery,
        )}
        rowKey="id"
        pagination={{
          defaultPageSize: 50,
        }}
        className="clearfix"
      >
        <Column
          title="#"
          dataIndex="id"
          render={(__, tracing) => FormatUtils.formatHash(tracing.id)}
          sorter
          className="monospace-id"
        />
        <Column
          title="Name"
          dataIndex="name"
          sorter
          render={(name, tracing) =>
            <EditableTextLabel
              value={name}
              onChange={newName => this.renameTracing(tracing, newName)}
            />}
        />
        <Column title="Dataset" dataIndex="dataSetName" sorter />
        <Column
          title="Stats"
          render={(__, tracing) =>
            tracing.stats && tracing.contentType === "skeletonTracing"
              ? <div>
                  <span title="Trees">
                    <i className="fa fa-sitemap" />
                    {tracing.stats.numberOfTrees}
                  </span>
                  <br />
                  <span title="Nodes">
                    <i className="fa fa-bull" />
                    {tracing.stats.numberOfNodes}
                  </span>
                  <br />
                  <span title="Edges">
                    <i className="fa fa-arrows-h" />
                    {tracing.stats.numberOfEdges}
                  </span>
                </div>
              : null}
        />
        <Column title="Type" dataIndex="contentType" />
        <Column title="Creation Date" dataIndex="created" sorter />
        <Column
          title="Actions"
          className="nowrap"
          key="action"
          render={(__, tracing) => this.renderActions(tracing)}
        />
      </Table>
    );
  }

  render() {
    return (
      <div>
        <Search
          style={{ width: 200, float: "right" }}
          onPressEnter={this.handleSearch}
          onChange={this.handleSearch}
        />
        <h3>Explorative Annotations</h3>
        {this.props.isAdminView
          ? null
          : <div>
              <Upload
                action="/admin/nml/upload"
                accept=".nml, .zip"
                name="nmlFile"
                multiple
                showUploadList={false}
                onChange={this.handleNMLUpload}
              >
                <Button icon="upload" loading={this.state.isUploadingNML}>
                  Upload Annotation
                </Button>
              </Upload>
              <div className="divider-vertical" />
              <Button onClick={this.toggleShowArchived}>
                Show {this.state.shouldShowArchivedTracings ? "Open" : "Archived"} Tracings
              </Button>
              <span style={{ marginLeft: 5 }}>
                {!this.state.shouldShowArchivedTracings
                  ? <Button onClick={this.archiveAll}>Archive All</Button>
                  : null}
              </span>
            </div>}

        {this.state.requestCount === 0
          ? this.renderTable()
          : <div className="text-center">
              <Spin size="large" />
            </div>}
      </div>
    );
  }
}
