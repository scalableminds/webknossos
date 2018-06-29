// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import _ from "lodash";
import * as React from "react";
import { Link, withRouter } from "react-router-dom";
import Request from "libs/request";
import { AsyncLink } from "components/async_clickables";
import { Spin, Input, Table, Button, Modal, Tag, Icon } from "antd";
import FormatUtils from "libs/format_utils";
import Toast from "libs/toast";
import Utils from "libs/utils";
import update from "immutability-helper";
import TemplateHelpers from "libs/template_helpers";
import messages from "messages";
import EditableTextLabel from "oxalis/view/components/editable_text_label";
import EditableTextIcon from "oxalis/view/components/editable_text_icon";
import FileUpload from "components/file_upload";
import Persistence from "libs/persistence";
import { PropTypes } from "@scalableminds/prop-types";
import type { APIAnnotationType } from "admin/api_flow_types";
import {
  finishAllAnnotations,
  editAnnotation,
  finishAnnotation,
  reOpenAnnotation,
} from "admin/admin_rest_api";
import type { RouterHistory } from "react-router-dom";
import { handleGenericError } from "libs/error_handling";

const { Column } = Table;
const { Search } = Input;

const typeHint: APIAnnotationType[] = [];

type Props = {
  userId: ?string,
  isAdminView: boolean,
  history: RouterHistory,
};

type State = {
  shouldShowArchivedTracings: boolean,
  archivedTracings: Array<APIAnnotationType>,
  unarchivedTracings: Array<APIAnnotationType>,
  didAlreadyFetchMetaInfo: {
    isArchived: boolean,
    isUnarchived: boolean,
  },
  searchQuery: string,
  isUploadingNML: boolean,
  tags: Array<string>,
  isLoading: boolean,
};

const persistence: Persistence<State> = new Persistence(
  {
    searchQuery: PropTypes.string,
    shouldShowArchivedTracings: PropTypes.bool,
  },
  "explorativeList",
);

class ExplorativeAnnotationsView extends React.PureComponent<Props, State> {
  state = {
    shouldShowArchivedTracings: false,
    archivedTracings: [],
    unarchivedTracings: [],
    didAlreadyFetchMetaInfo: {
      isArchived: false,
      isUnarchived: false,
    },
    searchQuery: "",
    isUploadingNML: false,
    tags: [],
    isLoading: false,
  };

  componentWillMount() {
    this.setState(persistence.load(this.props.history));
  }

  componentDidMount() {
    this.restoreSearchTags();
    this.fetchDataMaybe();
  }

  componentWillUpdate(nextProps, nextState) {
    persistence.persist(this.props.history, nextState);
  }

  componentDidUpdate(prevProps, prevState) {
    if (this.state.shouldShowArchivedTracings !== prevState.shouldShowArchivedTracings) {
      this.fetchDataMaybe();
    }
  }

  isFetchNecessary(): boolean {
    const accessor = this.state.shouldShowArchivedTracings ? "isArchived" : "isUnarchived";
    return !this.state.didAlreadyFetchMetaInfo[accessor];
  }

  restoreSearchTags() {
    // restore the search query tags from the last session
    const searchTagString = localStorage.getItem("lastDashboardSearchTags");
    if (searchTagString) {
      try {
        const searchTags = JSON.parse(searchTagString);
        this.setState({ tags: searchTags });
      } catch (error) {
        // pass
      }
    }
  }

  async fetchDataMaybe(): Promise<void> {
    if (!this.isFetchNecessary()) {
      return;
    }
    // Cache shouldShowArchivedTracings, otherwise it could have another value later
    const showArchivedTracings = this.state.shouldShowArchivedTracings;
    const isFinishedString = showArchivedTracings.toString();
    const url = this.props.userId
      ? `/api/users/${this.props.userId}/annotations?isFinished=${isFinishedString}`
      : `/api/user/annotations?isFinished=${isFinishedString}`;

    try {
      this.setState({ isLoading: true });
      const tracings = await Request.receiveJSON(url);
      if (showArchivedTracings) {
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
    } catch (error) {
      handleGenericError(error);
    } finally {
      this.setState({ isLoading: false });
    }
  }

  toggleShowArchived = () => {
    this.setState({ shouldShowArchivedTracings: !this.state.shouldShowArchivedTracings });
  };

  finishOrReopenTracing = async (type: "finish" | "reopen", tracing: APIAnnotationType) => {
    const newTracing =
      type === "finish"
        ? await finishAnnotation(tracing.id, tracing.typ)
        : await reOpenAnnotation(tracing.id, tracing.typ);

    if (type === "finish") {
      Toast.success(messages["annotation.was_finished"]);
    } else {
      Toast.success(messages["annotation.was_re_opened"]);
    }

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

  handleNMLUpload = (response: Object) => {
    this.props.history.push(`/annotations/${response.annotation.typ}/${response.annotation.id}`);
  };

  renderActions = (tracing: APIAnnotationType) => {
    if (tracing.typ !== "Explorational") {
      return null;
    }

    const { typ, id } = tracing;
    if (!this.state.shouldShowArchivedTracings) {
      return (
        <div>
          <Link to={`/annotations/${typ}/${id}`}>
            <Icon type="play-circle-o" />Trace
          </Link>
          <br />
          <a href={`/api/annotations/${typ}/${id}/download`}>
            <Icon type="download" />Download
          </a>
          <br />
          <AsyncLink href="#" onClick={() => this.finishOrReopenTracing("finish", tracing)}>
            <Icon type="inbox" />Archive
          </AsyncLink>
          <br />
        </div>
      );
    } else {
      return (
        <div>
          <AsyncLink href="#" onClick={() => this.finishOrReopenTracing("reopen", tracing)}>
            <Icon type="folder-open" />Reopen
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

  handleSearch = (event: SyntheticInputEvent<>): void => {
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

    editAnnotation(tracing.id, tracing.typ, { name }).then(() => {
      Toast.success(messages["annotation.was_edited"]);
    });
  }

  archiveAll = () => {
    const selectedAnnotations = this.getFilteredTracings();
    Modal.confirm({
      content: `Are you sure you want to archive all ${
        selectedAnnotations.length
      } explorative annotations matching the current search query / tags?`,
      onOk: async () => {
        const selectedAnnotationIds = selectedAnnotations.map(t => t.id);
        const data = await finishAllAnnotations(selectedAnnotationIds);
        Toast.messages(data.messages);

        this.setState({
          archivedTracings: this.state.archivedTracings.concat(selectedAnnotations),
          unarchivedTracings: _.without(this.state.unarchivedTracings, ...selectedAnnotations),
        });
      },
    });
  };

  addTagToSearch = (tag: string): void => {
    if (!this.state.tags.includes(tag)) {
      const newTags = update(this.state.tags, { $push: [tag] });
      this.setState({ tags: newTags });
      localStorage.setItem("lastDashboardSearchTags", JSON.stringify(newTags));
    }
  };

  removeTagFromSearch = (tag: string): void => {
    const newTags = this.state.tags.filter(t => t !== tag);
    this.setState({ tags: newTags });
    localStorage.setItem("lastDashboardSearchTags", JSON.stringify(newTags));
  };

  editTagFromAnnotation = (
    annotation: APIAnnotationType,
    shouldAddTag: boolean,
    tag: string,
    event: SyntheticInputEvent<>,
  ): void => {
    event.stopPropagation(); // prevent the onClick event
    const newTracings = this.state.unarchivedTracings.map(t => {
      let newAnnotation = t;

      if (t.id === annotation.id) {
        if (shouldAddTag) {
          // add the tag to an annotation
          newAnnotation = update(t, { tags: { $push: [tag] } });
        } else {
          // remove the tag from an annotation
          const newTags = _.without(t.tags, tag);
          newAnnotation = update(t, { tags: { $set: newTags } });
        }

        // persist to server
        editAnnotation(newAnnotation.id, newAnnotation.typ, {
          tags: newAnnotation.tags,
        });
      }
      return newAnnotation;
    });
    this.setState({ unarchivedTracings: newTracings });
  };

  handleSearchPressEnter = (event: SyntheticInputEvent<>) => {
    const value = event.target.value;
    if (value !== "") {
      this.addTagToSearch(event.target.value);
      this.setState({ searchQuery: "" });
    }
  };

  getFilteredTracings() {
    return Utils.filterWithSearchQueryAND(
      this.getCurrentTracings(),
      ["id", "name", "modified", "tags"],
      `${this.state.searchQuery} ${this.state.tags.join(" ")}`,
    );
  }

  renderTable() {
    return (
      <Table
        dataSource={this.getFilteredTracings()}
        rowKey="id"
        pagination={{
          defaultPageSize: 50,
        }}
      >
        <Column
          title="ID"
          dataIndex="id"
          render={(__, tracing: APIAnnotationType) => FormatUtils.formatHash(tracing.id)}
          sorter={Utils.localeCompareBy(typeHint, "id")}
          className="monospace-id"
        />
        <Column
          title="Name"
          dataIndex="name"
          sorter={Utils.localeCompareBy(typeHint, "name")}
          render={(name: string, tracing: APIAnnotationType) => (
            <EditableTextLabel
              value={name}
              onChange={newName => this.renameTracing(tracing, newName)}
            />
          )}
        />
        <Column
          title="Stats"
          render={(__, tracing: APIAnnotationType) =>
            tracing.stats.treeCount && tracing.content.typ === "skeleton" ? (
              <div>
                <span title="Trees">
                  <i className="fa fa-sitemap" />
                  {tracing.stats.treeCount}
                </span>
                <br />
                <span title="Nodes">
                  <i className="fa fa-bull" />
                  {tracing.stats.nodeCount}
                </span>
                <br />
                <span title="Edges">
                  <i className="fa fa-arrows-h" />
                  {tracing.stats.edgeCount}
                </span>
              </div>
            ) : null
          }
        />
        <Column
          title="Tags"
          dataIndex="tags"
          width={500}
          render={(tags: Array<string>, tracing: APIAnnotationType) => (
            <div>
              {tags.map(tag => (
                <Tag
                  key={tag}
                  color={TemplateHelpers.stringToColor(tag)}
                  onClick={_.partial(this.addTagToSearch, tag)}
                  onClose={_.partial(this.editTagFromAnnotation, tracing, false, tag)}
                  closable={
                    !(tag === tracing.dataSetName || tag === tracing.content.typ) &&
                    !this.state.shouldShowArchivedTracings
                  }
                >
                  {tag}
                </Tag>
              ))}
              {this.state.shouldShowArchivedTracings ? null : (
                <EditableTextIcon
                  icon="plus"
                  onChange={_.partial(this.editTagFromAnnotation, tracing, true)}
                />
              )}
            </div>
          )}
        />
        <Column
          title="Modification Date"
          dataIndex="modified"
          sorter={Utils.localeCompareBy(typeHint, "modified")}
        />
        <Column
          title="Actions"
          className="nowrap"
          key="action"
          render={(__, tracing: APIAnnotationType) => this.renderActions(tracing)}
        />
      </Table>
    );
  }

  renderSearchTags() {
    return this.state.tags.map(tag => (
      <Tag
        key={tag}
        color={TemplateHelpers.stringToColor(tag)}
        afterClose={_.partial(this.removeTagFromSearch, tag)}
        closable
      >
        {tag}
      </Tag>
    ));
  }

  render() {
    const marginRight = { marginRight: 8 };
    const search = (
      <Search
        style={{ width: 200, float: "right" }}
        onPressEnter={this.handleSearchPressEnter}
        onChange={this.handleSearch}
        value={this.state.searchQuery}
      />
    );

    return (
      <div className="TestExplorativeAnnotationsView">
        {this.props.isAdminView ? (
          search
        ) : (
          <div className="pull-right">
            <FileUpload
              url="/api/annotations/upload"
              accept=".nml, .zip"
              name="nmlFile"
              multiple
              showUploadList={false}
              onSuccess={this.handleNMLUpload}
              onUploading={() => this.setState({ isUploadingNML: true })}
              onError={() => this.setState({ isUploadingNML: false })}
            >
              <Button icon="upload" loading={this.state.isUploadingNML} style={marginRight}>
                Upload Annotation
              </Button>
            </FileUpload>
            <Button onClick={this.toggleShowArchived} style={marginRight}>
              Show {this.state.shouldShowArchivedTracings ? "Open" : "Archived"} Annotations
            </Button>
            {!this.state.shouldShowArchivedTracings ? (
              <Button onClick={this.archiveAll} style={marginRight}>
                Archive All
              </Button>
            ) : null}
            {search}
          </div>
        )}
        <h3>Explorative Annotations</h3>
        {this.renderSearchTags()}
        <div className="clearfix" style={{ margin: "20px 0px" }} />
        <Spin spinning={this.state.isLoading} size="large">
          {this.renderTable()}
        </Spin>
      </div>
    );
  }
}

export default withRouter(ExplorativeAnnotationsView);
