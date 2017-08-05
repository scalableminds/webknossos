// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import _ from "lodash";
import React from "react";
import Request from "libs/request";
import { Table } from "antd";
import type { APIAnnotationType } from "admin/api_flow_types";
import FormatUtils from "libs/format_utils";
import Toast from "libs/toast";

const { Column } = Table;

type Props = {
  userID: ?string,
  isAdminView: boolean,
};

const cachedReceiveJSON = _.memoize(Request.receiveJSON);

export default class ExplorativeAnnotationsView extends React.PureComponent {
  props: Props;
  state: {
    showArchivedTracings: boolean,
    tracings: Array<APIAnnotationType>,
  } = {
    showArchivedTracings: false,
    tracings: [],
  };

  componentDidMount() {
    this.fetchData();
  }

  fetchFresh(): Promise<void> {
    cachedReceiveJSON.cache.clear();
    return this.fetchData();
  }

  async fetchData(): Promise<void> {
    const isFinished = this.state.showArchivedTracings.toString();
    const url = this.props.userID
      ? `/api/users/${this.props.userID}/annotations?isFinished=${isFinished}`
      : `/api/user/annotations?isFinished=${isFinished}`;

    const tracings = await cachedReceiveJSON(url);

    this.setState({
      tracings,
    });
  }

  toggleShowArchived = () => {
    this.setState({ showArchivedTracings: !this.state.showArchivedTracings }, () =>
      this.fetchData(),
    );
  };

  finishOrReopenTracing = (type: "finish" | "reopen", tracing: APIAnnotationType) => {
    const controller = jsRoutes.controllers.AnnotationController;
    const url =
      type === "finish"
        ? controller.finish(tracing.typ, tracing.id).url
        : controller.reopen(tracing.typ, tracing.id).url;

    Request.receiveJSON(url).then(response => {
      Toast.message(response.messages);

      const tracings = this.state.tracings.filter(t => t.id !== tracing.id);
      this.setState({ tracings });
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

  render() {
    return (
      <div>
        <h3>Explorative Annotations</h3>
        {!this.props.isAdminView
          ? <div>
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
            </div>
          : null}

        <Table
          dataSource={this.state.tracings.filter(
            tracing => tracing.state.isFinished === this.state.showArchivedTracings,
          )}
          rowKey="id"
          pagination={{
            defaultPageSize: 50,
          }}
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
