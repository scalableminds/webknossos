// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import React from "react";
import Request from "libs/request";
import { Spin, Input, Table } from "antd";
import type { APIAnnotationType } from "admin/api_flow_types";
import FormatUtils from "libs/format_utils";
import Toast from "libs/toast";
import Utils from "libs/utils";
import update from "immutability-helper";
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
    showArchivedTracings: boolean,
    archivedTracings: Array<APIAnnotationType>,
    unarchivedTracings: Array<APIAnnotationType>,
    alreadyFetchedMetaInfo: {
      archived: boolean,
      unarchived: boolean,
    },
    searchQuery: string,
    requestCount: number,
  } = {
    showArchivedTracings: false,
    archivedTracings: [],
    unarchivedTracings: [],
    alreadyFetchedMetaInfo: {
      archived: false,
      unarchived: false,
    },
    searchQuery: "",
    requestCount: 0,
  };

  componentDidMount() {
    this.fetchDataMaybe();
  }

  isFetchNecessary(): boolean {
    const accessor = this.state.showArchivedTracings ? "archived" : "unarchived";
    return !this.state.alreadyFetchedMetaInfo[accessor];
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

    const isFinishedString = this.state.showArchivedTracings.toString();
    const url = this.props.userID
      ? `/api/users/${this.props.userID}/annotations?isFinished=${isFinishedString}`
      : `/api/user/annotations?isFinished=${isFinishedString}`;

    this.enterRequest();
    const tracings = await Request.receiveJSON(url);
    this.leaveRequest();
    if (this.state.showArchivedTracings) {
      this.setState(
        update(this.state, {
          archivedTracings: { $set: tracings },
          alreadyFetchedMetaInfo: {
            archived: { $set: true },
          },
        }),
      );
    } else {
      this.setState(
        update(this.state, {
          unarchivedTracings: { $set: tracings },
          alreadyFetchedMetaInfo: {
            unarchived: { $set: true },
          },
        }),
      );
    }
  }

  toggleShowArchived = () => {
    this.setState({ showArchivedTracings: !this.state.showArchivedTracings }, () =>
      this.fetchDataMaybe(),
    );
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

  renderActions = (tracing: APIAnnotationType) => {
    if (tracing.typ !== "Explorational") {
      return null;
    }

    const controller = jsRoutes.controllers.AnnotationController;
    const { typ, id } = tracing;
    if (!this.state.showArchivedTracings) {
      return (
        <div>
          <a href={controller.trace(typ, id).url}>
            <i className="fa fa-random" />
            <strong>trace</strong>
          </a>
          <br />
          <a href={jsRoutes.controllers.AnnotationIOController.download(typ, id).url}>
            <i className="fa fa-download" />
            download
          </a>
          <br />
          <a href="#" onClick={() => this.finishOrReopenTracing("finish", tracing)}>
            <i className="fa fa-archive" />
            archive
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
    return this.state.showArchivedTracings
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
      [this.state.showArchivedTracings ? "archivedTracings" : "unarchivedTracings"]: newTracings,
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
        <Column title="Data Set" dataIndex="dataSetName" sorter />
        <Column
          title="Stats"
          render={(__, tracing) =>
            tracing.stats && tracing.contentType === "skeletonTracing"
              ? <div>
                  <span title="Trees">
                    <i className="fa fa-sitemap" />
                    {tracing.stats.numberOfTrees}&nbsp;
                  </span>
                  <br />
                  <span title="Nodes">
                    <i className="fa fa-bull" />
                    {tracing.stats.numberOfNodes}&nbsp;
                  </span>
                  <br />
                  <span title="Edges">
                    <i className="fa fa-arrows-h" />
                    {tracing.stats.numberOfEdges}
                  </span>
                </div>
              : null}
        />
        <Column
          title="Type"
          dataIndex="contentType"
          render={(type, tracing) => `${type} - ${tracing.typ}`}
        />
        <Column title="Created" dataIndex="created" sorter />
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
              <form
                action={jsRoutes.controllers.AnnotationIOController.upload().url}
                method="POST"
                encType="multipart/form-data"
                id="upload-and-explore-form"
                className="form-inline inline-block"
              >
                <div id="fileinput" className="fileinput fileinput-new" data-provides="fileinput">
                  <span className="btn btn-default btn-file">
                    <span>
                      <i className="fa fa-upload fileinput-new" id="form-upload-icon" />
                      <i
                        className="fa fa-spinner fa-spin fileinput-exists"
                        id="form-spinner-icon"
                      />
                      Upload Annotation
                    </span>
                    <input type="file" name="nmlFile" multiple accept=".nml, .zip" />
                  </span>
                </div>
              </form>

              <div className="divider-vertical" />

              <a href="#" className="btn btn-default" onClick={this.toggleShowArchived}>
                <i className="fa fa-spinner fa-spin hide" />
                Show {this.state.showArchivedTracings ? "open" : "archived"} tracings
              </a>

              <span style={{ marginLeft: 5 }}>
                {!this.state.showArchivedTracings
                  ? <a href="#" className="btn btn-default" onClick={this.archiveAll}>
                      Archive all
                    </a>
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
