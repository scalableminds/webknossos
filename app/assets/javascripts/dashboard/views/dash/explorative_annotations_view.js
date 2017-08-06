// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import React from "react";
import Request from "libs/request";
import { Input, Table } from "antd";
import type { APIAnnotationType } from "admin/api_flow_types";
import FormatUtils from "libs/format_utils";
import Toast from "libs/toast";
import Utils from "libs/utils";
import update from "immutability-helper";

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
  } = {
    showArchivedTracings: false,
    archivedTracings: [],
    unarchivedTracings: [],
    alreadyFetchedMetaInfo: {
      archived: false,
      unarchived: false,
    },
    searchQuery: "",
  };

  componentDidMount() {
    this.fetchDataMaybe();
  }

  isFetchNecessary(): boolean {
    const accessor = this.state.showArchivedTracings ? "archived" : "unarchived";
    return !this.state.alreadyFetchedMetaInfo[accessor];
  }

  async fetchDataMaybe(): Promise<void> {
    if (!this.isFetchNecessary()) {
      return;
    }

    const isFinishedString = this.state.showArchivedTracings.toString();
    const url = this.props.userID
      ? `/api/users/${this.props.userID}/annotations?isFinished=${isFinishedString}`
      : `/api/user/annotations?isFinished=${isFinishedString}`;

    const tracings = await Request.receiveJSON(url);
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

              <span>
                <a href="#" className="btn btn-default" onClick={this.toggleShowArchived}>
                  <i className="fa fa-spinner fa-spin hide" />
                  {this.state.showArchivedAnnotations
                    ? "Show open tracings"
                    : "Show archived tracings"}
                </a>
                {this.state.showArchivedAnnotations
                  ? <a href="#" id="archive-all" className="btn btn-default">
                      Archive all
                    </a>
                  : null}
              </span>
            </div>}

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
            render={(__, task) => FormatUtils.formatHash(task.id)}
            sorter
            className="monospace-id"
          />
          <Column title="Name" dataIndex="name" sorter />
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

        <div className="modal-container" />
      </div>
    );
  }
}
