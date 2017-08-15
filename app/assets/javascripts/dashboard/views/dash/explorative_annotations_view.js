// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import _ from "lodash";
import React from "react";
import Request from "libs/request";
import { AsyncLink } from "components/async_clickables";
import { Spin, Input, Table, Button, Upload, Modal, Tag } from "antd";
import type { APIAnnotationType } from "admin/api_flow_types";
import FormatUtils from "libs/format_utils";
import Toast from "libs/toast";
import Utils from "libs/utils";
import update from "immutability-helper";
import app from "app";
import TemplateHelpers from "libs/template_helpers";
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
    tags: Array<string>,
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
    tags: [],
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
    this.setState({ shouldShowArchivedTracings: !this.state.shouldShowArchivedTracings }, () => {
      this.fetchDataMaybe();
    });
  };

  finishOrReopenTracing = async (type: "finish" | "reopen", tracing: APIAnnotationType) => {
    const controller = jsRoutes.controllers.AnnotationController;
    const url =
      type === "finish"
        ? controller.finish(tracing.typ, tracing.id).url
        : controller.reopen(tracing.typ, tracing.id).url;

    const newTracing = await Request.receiveJSON(url);
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
          <AsyncLink href="#" onClick={() => this.finishOrReopenTracing("finish", tracing)}>
            <i className="fa fa-archive" />
            Archive
          </AsyncLink>
          <br />
        </div>
      );
    } else {
      return (
        <div>
          <AsyncLink href="#" onClick={() => this.finishOrReopenTracing("reopen", tracing)}>
            <i className="fa fa-folder-open" />
            reopen
          </AsyncLink>
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
    Modal.confirm({
      content: "Are you sure you want to archive all explorative annotations?",
      onOk: async () => {
        const unarchivedAnnoationIds = this.state.unarchivedTracings.map(t => t.id);
        const data = await Request.sendJSONReceiveJSON(
          jsRoutes.controllers.AnnotationController.finishAll("Explorational").url,
          {
            method: "POST",
            data: {
              annotations: unarchivedAnnoationIds,
            },
          },
        );
        Toast.message(data.messages);

        this.setState({
          archivedTracings: this.state.unarchivedTracings.concat(this.state.archivedTracings),
          unarchivedTracings: [],
        });
      },
    });
  };

  addTagToSearch = (tag: string): void => {
    if (!this.state.tags.includes(tag)) {
      this.setState(update(this.state, { tags: { $push: [tag] } }));
    }
  };

  removeTagFromSearch = (tag: string): void => {
    this.setState({ tags: this.state.tags.filter(t => t !== tag) });
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
      >
        <Column
          title="#"
          dataIndex="id"
          render={(__, tracing) => FormatUtils.formatHash(tracing.id)}
          sorter={Utils.localeCompareBy("id")}
          className="monospace-id"
        />
        <Column
          title="Name"
          dataIndex="name"
          sorter={Utils.localeCompareBy("name")}
          render={(name, tracing) =>
            <EditableTextLabel
              value={name}
              onChange={newName => this.renameTracing(tracing, newName)}
            />}
        />
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
        <Column
          title="Tags"
          dataIndex="tags"
          render={tags =>
            tags.map(tag =>
              <Tag
                key={tag}
                color={TemplateHelpers.stringToColor(tag)}
                onClick={_.partial(this.addTagToSearch, tag)}
              >
                {tag}
              </Tag>,
            )}
        />
        <Column
          title="Creation Date"
          dataIndex="created"
          sorter={Utils.localeCompareBy("created")}
        />
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
    const marginRight = { marginRight: 8 };
    const search = (
      <Search
        style={{ width: 200, float: "right" }}
        onPressEnter={this.handleSearch}
        onChange={this.handleSearch}
      />
    );

    return (
      <div>
        {this.props.isAdminView
          ? search
          : <div className="pull-right">
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
              <Button onClick={this.toggleShowArchived} style={marginRight}>
                Show {this.state.shouldShowArchivedTracings ? "Open" : "Archived"} Tracings
              </Button>
              {!this.state.shouldShowArchivedTracings
                ? <Button onClick={this.archiveAll} style={marginRight}>
                    Archive All
                  </Button>
                : null}
              {search}
            </div>}
        <h3>Explorative Annotations</h3>
        <div className="clearfix" style={{ margin: "20px 0px" }} />

        {this.state.tags.map(tag =>
          <Tag
            key={tag}
            color={TemplateHelpers.stringToColor(tag)}
            afterClose={_.partial(this.removeTagFromSearch, tag)}
            closable
          >
            {tag}
          </Tag>,
        )}

        {this.state.requestCount === 0
          ? this.renderTable()
          : <div className="text-center">
              <Spin size="large" />
            </div>}
      </div>
    );
  }
}
