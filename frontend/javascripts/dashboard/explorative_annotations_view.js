// @flow
import { Link, type RouterHistory, withRouter } from "react-router-dom";
import { PropTypes } from "@scalableminds/prop-types";
import { Spin, Input, Table, Button, Modal, Tooltip } from "antd";
import {
  DownloadOutlined,
  FolderOpenOutlined,
  InboxOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  UploadOutlined,
  CopyOutlined,
} from "@ant-design/icons";
import * as React from "react";
import _ from "lodash";
import update from "immutability-helper";
import { AsyncLink } from "components/async_clickables";

import type { APIAnnotationCompact } from "types/api_flow_types";
import { AnnotationContentTypes } from "oxalis/constants";

import {
  finishAllAnnotations,
  editAnnotation,
  finishAnnotation,
  reOpenAnnotation,
  getCompactAnnotations,
  downloadNml,
  getCompactAnnotationsForUser,
} from "admin/admin_rest_api";
import { formatHash } from "libs/format_utils";
import { handleGenericError } from "libs/error_handling";
import { setDropzoneModalVisibilityAction } from "oxalis/model/actions/ui_actions";
import EditableTextIcon from "oxalis/view/components/editable_text_icon";
import FormattedDate from "components/formatted_date";
import Persistence from "libs/persistence";
import CategorizationLabel, {
  CategorizationSearch,
} from "oxalis/view/components/categorization_label";
import Store from "oxalis/store";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import messages from "messages";
import { trackAction } from "oxalis/model/helpers/analytics";
import TextWithDescription from "components/text_with_description";
import { getVolumeDescriptors } from "oxalis/model/accessors/volumetracing_accessor";

const { Column } = Table;
const { Search } = Input;

const typeHint: APIAnnotationCompact[] = [];
const pageLength: number = 1000;

export type TracingModeState = {
  tracings: Array<APIAnnotationCompact>,
  lastLoadedPage: number,
  loadedAllTracings: boolean,
};

type Props = {
  userId: ?string,
  isAdminView: boolean,
  history: RouterHistory,
};

type State = {
  shouldShowArchivedTracings: boolean,
  archivedModeState: TracingModeState,
  unarchivedModeState: TracingModeState,
  searchQuery: string,
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
    archivedModeState: {
      tracings: [],
      lastLoadedPage: -1,
      loadedAllTracings: false,
    },
    unarchivedModeState: {
      tracings: [],
      lastLoadedPage: -1,
      loadedAllTracings: false,
    },
    searchQuery: "",
    tags: [],
    isLoading: false,
  };

  componentDidMount() {
    this.setState(persistence.load(this.props.history));
    this.fetchNextPage(0);
  }

  componentDidUpdate() {
    persistence.persist(this.props.history, this.state);
  }

  getCurrentModeState = () =>
    this.state.shouldShowArchivedTracings
      ? this.state.archivedModeState
      : this.state.unarchivedModeState;

  setModeState = modeShape => {
    const { shouldShowArchivedTracings } = this.state;
    this.setState(prevState => {
      const newSubState = {
        // $FlowIssue[exponential-spread] See https://github.com/facebook/flow/issues/8299
        ...prevState[shouldShowArchivedTracings ? "archivedModeState" : "unarchivedModeState"],
        ...modeShape,
      };
      return {
        // $FlowIssue[invalid-computed-prop] See https://github.com/facebook/flow/issues/8299
        [shouldShowArchivedTracings ? "archivedModeState" : "unarchivedModeState"]: newSubState,
      };
    });
  };

  setOppositeModeState = modeShape => {
    const { shouldShowArchivedTracings } = this.state;
    this.setState(prevState => {
      const newSubState = {
        // $FlowIssue[exponential-spread] See https://github.com/facebook/flow/issues/8299
        ...prevState[shouldShowArchivedTracings ? "unarchivedModeState" : "archivedModeState"],
        ...modeShape,
      };
      return {
        // $FlowIssue[invalid-computed-prop] See https://github.com/facebook/flow/issues/8299
        [shouldShowArchivedTracings ? "unarchivedModeState" : "archivedModeState"]: newSubState,
      };
    });
  };

  fetchNextPage = async pageNumber => {
    // this refers not to the pagination of antd but to the pagination of querying data from SQL
    const showArchivedTracings = this.state.shouldShowArchivedTracings;
    const previousTracings = this.getCurrentModeState().tracings;

    try {
      this.setState({ isLoading: true });
      const tracings =
        this.props.userId != null
          ? await getCompactAnnotationsForUser(this.props.userId, showArchivedTracings, pageNumber)
          : await getCompactAnnotations(showArchivedTracings, pageNumber);

      this.setModeState({
        tracings: previousTracings.concat(tracings),
        lastLoadedPage: pageNumber,
        loadedAllTracings: tracings.length !== pageLength || tracings.length === 0,
      });
    } catch (error) {
      handleGenericError(error);
    } finally {
      this.setState({ isLoading: false });
    }
  };

  toggleShowArchived = () => {
    this.setState(
      prevState => ({
        shouldShowArchivedTracings: !prevState.shouldShowArchivedTracings,
      }),
      () => {
        if (this.getCurrentModeState().lastLoadedPage === -1) this.fetchNextPage(0);
      },
    );
  };

  finishOrReopenTracing = async (type: "finish" | "reopen", tracing: APIAnnotationCompact) => {
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
      this.setModeState({ tracings: newTracings });
      this.setOppositeModeState({
        tracings: [newTracing].concat(this.state.archivedModeState.tracings),
      });
    } else {
      this.setModeState({ tracings: newTracings });
      this.setOppositeModeState({
        tracings: [newTracing].concat(this.state.unarchivedModeState.tracings),
      });
    }
  };

  renderActions = (tracing: APIAnnotationCompact) => {
    if (tracing.typ !== "Explorational") {
      return null;
    }

    const hasVolumeTracing = getVolumeDescriptors(tracing).length > 0;
    const { typ, id } = tracing;
    if (!this.state.shouldShowArchivedTracings) {
      return (
        <div>
          <Link to={`/annotations/${typ}/${id}`}>
            <PlayCircleOutlined />
            Trace
          </Link>
          <br />
          <AsyncLink
            href="#"
            onClick={() => downloadNml(id, typ, hasVolumeTracing)}
            icon={<DownloadOutlined key="download" />}
          >
            Download
          </AsyncLink>
          <br />
          <AsyncLink
            href="#"
            onClick={() => this.finishOrReopenTracing("finish", tracing)}
            icon={<InboxOutlined key="inbox" />}
          >
            Archive
          </AsyncLink>
          <br />
        </div>
      );
    } else {
      return (
        <div>
          <AsyncLink
            href="#"
            onClick={() => this.finishOrReopenTracing("reopen", tracing)}
            icon={<FolderOpenOutlined key="folder" />}
          >
            Reopen
          </AsyncLink>
          <br />
        </div>
      );
    }
  };

  getCurrentTracings(): Array<APIAnnotationCompact> {
    return this.getCurrentModeState().tracings;
  }

  handleSearch = (event: SyntheticInputEvent<>): void => {
    this.setState({ searchQuery: event.target.value });
  };

  renameTracing(tracing: APIAnnotationCompact, name: string) {
    const tracings = this.getCurrentTracings();

    const newTracings = tracings.map(currentTracing => {
      if (currentTracing.id !== tracing.id) {
        return currentTracing;
      } else {
        return update(currentTracing, { name: { $set: name } });
      }
    });

    this.setModeState({ tracings: newTracings });

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

        this.setState(prevState => ({
          archivedModeState: {
            ...prevState.archivedModeState,
            tracings: prevState.archivedModeState.tracings.concat(selectedAnnotations),
          },
          unarchivedModeState: {
            ...prevState.unarchivedModeState,
            tracings: _.without(prevState.unarchivedModeState.tracings, ...selectedAnnotations),
          },
        }));
      },
    });
  };

  addTagToSearch = (tag: string): void => {
    if (!this.state.tags.includes(tag)) {
      this.setState(prevState => ({ tags: [...prevState.tags, tag] }));
    }
  };

  editTagFromAnnotation = (
    annotation: APIAnnotationCompact,
    shouldAddTag: boolean,
    tag: string,
    event: SyntheticInputEvent<>,
  ): void => {
    event.stopPropagation(); // prevent the onClick event

    this.setState(prevState => {
      const newTracings = prevState.unarchivedModeState.tracings.map(t => {
        let newAnnotation = t;

        if (t.id === annotation.id) {
          if (shouldAddTag) {
            // add the tag to an annotation
            if (!t.tags.includes(tag)) {
              newAnnotation = update(t, { tags: { $push: [tag] } });
            }
          } else {
            // remove the tag from an annotation
            const newTags = _.without(t.tags, tag);
            newAnnotation = update(t, { tags: { $set: newTags } });
          }

          // persist to server
          editAnnotation(newAnnotation.id, newAnnotation.typ, {
            tags: newAnnotation.tags,
          });
          trackAction("Edit annotation tag");
        }
        return newAnnotation;
      });
      return { unarchivedModeState: { ...prevState.unarchivedModeState, tracings: newTracings } };
    });
  };

  handleSearchPressEnter = (event: SyntheticInputEvent<>) => {
    const { value } = event.target;
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

  renderIdAndCopyButton(tracing: APIAnnotationCompact) {
    const copyIdToClipboard = async () => {
      await navigator.clipboard.writeText(tracing.id);
      Toast.success("ID copied to clipboard");
    };
    return (
      <div>
        {formatHash(tracing.id)}
        <Tooltip title="Copy long ID" placement="bottom">
          <Button
            onClick={copyIdToClipboard}
            icon={<CopyOutlined className="without-icon-margin" />}
            style={{
              boxShadow: "none",
              backgroundColor: "transparent",
              borderColor: "transparent",
            }}
          />
        </Tooltip>
      </div>
    );
  }

  renderNameWithDescription(tracing: APIAnnotationCompact) {
    return (
      <TextWithDescription
        isEditable
        value={tracing.name ? tracing.name : "Unnamed Annotation"}
        onChange={newName => this.renameTracing(tracing, newName)}
        label="Annotation Name"
        description={tracing.description}
      />
    );
  }

  renderTable() {
    const filteredAndSortedTracings = this.getFilteredTracings().sort(
      Utils.compareBy(typeHint, annotation => annotation.modified, false),
    );

    return (
      <Table
        dataSource={filteredAndSortedTracings}
        rowKey="id"
        pagination={{
          defaultPageSize: 50,
        }}
        className="large-table"
        scroll={{ x: "max-content" }}
        locale={{
          emptyText: (
            <p>
              Create annotations by opening a dataset from{" "}
              <Link to="/dashboard/datasets">the datasets page</Link>.
            </p>
          ),
        }}
      >
        <Column
          title="ID"
          dataIndex="id"
          width={100}
          render={(__, tracing: APIAnnotationCompact) => this.renderIdAndCopyButton(tracing)}
          sorter={Utils.localeCompareBy(typeHint, annotation => annotation.id)}
          className="monospace-id"
        />
        <Column
          title="Name"
          width={280}
          dataIndex="name"
          sorter={Utils.localeCompareBy(typeHint, annotation => annotation.name)}
          render={(name: string, tracing: APIAnnotationCompact) =>
            this.renderNameWithDescription(tracing)
          }
        />
        <Column
          title="Stats"
          width={150}
          render={(__, annotation: APIAnnotationCompact) =>
            // Flow doesn't recognize that stats must contain the nodeCount if the treeCount is != null
            annotation.stats.treeCount != null &&
            annotation.stats.nodeCount != null &&
            annotation.stats.edgeCount != null ? (
              <div style={{ display: "grid", gridTemplateColumns: "30% auto" }}>
                <span title="Trees" style={{ margin: "auto" }}>
                  <i className="fas fa-sitemap" />
                </span>
                <span>{annotation.stats.treeCount}</span>
                <span title="Nodes" style={{ margin: "auto" }}>
                  <i className="fas fa-circle fa-sm" />
                </span>
                <span>{annotation.stats.nodeCount}</span>
                <span title="Edges" style={{ margin: "auto" }}>
                  <i className="fas fa-arrows-alt-h" />
                </span>
                <span>{annotation.stats.edgeCount}</span>
              </div>
            ) : null
          }
        />
        <Column
          title="Tags"
          dataIndex="tags"
          render={(tags: Array<string>, annotation: APIAnnotationCompact) => (
            <div>
              {tags.map(tag => (
                <CategorizationLabel
                  key={tag}
                  kind="annotations"
                  onClick={_.partial(this.addTagToSearch, tag)}
                  onClose={_.partial(this.editTagFromAnnotation, annotation, false, tag)}
                  tag={tag}
                  closable={
                    !(tag === annotation.dataSetName || AnnotationContentTypes.includes(tag)) &&
                    !this.state.shouldShowArchivedTracings
                  }
                />
              ))}
              {this.state.shouldShowArchivedTracings ? null : (
                <EditableTextIcon
                  icon={<PlusOutlined />}
                  onChange={_.partial(this.editTagFromAnnotation, annotation, true)}
                />
              )}
            </div>
          )}
        />
        <Column
          title="Modification Date"
          dataIndex="modified"
          width={200}
          sorter={Utils.compareBy(typeHint, annotation => annotation.modified)}
          render={modified => <FormattedDate timestamp={modified} />}
        />
        <Column
          width={200}
          fixed="right"
          title="Actions"
          className="nowrap"
          key="action"
          render={(__, tracing: APIAnnotationCompact) => this.renderActions(tracing)}
        />
      </Table>
    );
  }

  renderSearchTags() {
    return (
      <CategorizationSearch
        searchTags={this.state.tags}
        setTags={tags => this.setState({ tags })}
        localStorageSavingKey="lastDashboardSearchTags"
      />
    );
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
            <Button
              icon={<UploadOutlined />}
              style={marginRight}
              onClick={() => Store.dispatch(setDropzoneModalVisibilityAction(true))}
            >
              Upload Annotation(s)
            </Button>
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
        {this.renderSearchTags()}
        <div className="clearfix" style={{ margin: "20px 0px" }} />
        <Spin spinning={this.state.isLoading} size="large">
          {this.renderTable()}
        </Spin>
        <div style={{ textAlign: "right" }}>
          {!this.getCurrentModeState().loadedAllTracings ? (
            <Link
              to="#"
              onClick={() => this.fetchNextPage(this.getCurrentModeState().lastLoadedPage + 1)}
            >
              Load more Annotations
            </Link>
          ) : null}
        </div>
      </div>
    );
  }
}

export default withRouter(ExplorativeAnnotationsView);
