// @flow
// @ts-expect-error ts-migrate(2305) FIXME: Module '"react-router-dom"' has no exported member... Remove this comment to see the full error message
import type { RouterHistory } from "react-router-dom";
import { Link, withRouter } from "react-router-dom";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module '@sca... Remove this comment to see the full error message
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
  tracings: Array<APIAnnotationCompact>;
  lastLoadedPage: number;
  loadedAllTracings: boolean;
};
type Props = {
  userId: string | null | undefined;
  isAdminView: boolean;
  history: RouterHistory;
};
type State = {
  shouldShowArchivedTracings: boolean;
  archivedModeState: TracingModeState;
  unarchivedModeState: TracingModeState;
  searchQuery: string;
  tags: Array<string>;
  isLoading: boolean;
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
    this.setState(persistence.load(this.props.history), () => this.fetchNextPage(0));
  }

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter '_prevProps' implicitly has an 'any' typ... Remove this comment to see the full error message
  componentDidUpdate(_prevProps, prevState) {
    persistence.persist(this.props.history, this.state);

    if (this.state.shouldShowArchivedTracings !== prevState.shouldShowArchivedTracings) {
      this.fetchNextPage(0);
    }
  }

  getCurrentModeState = () =>
    this.state.shouldShowArchivedTracings
      ? this.state.archivedModeState
      : this.state.unarchivedModeState;

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'modeShape' implicitly has an 'any' type... Remove this comment to see the full error message
  setModeState = (modeShape, addToArchivedTracings) =>
    this.addToShownTracings(modeShape, addToArchivedTracings);

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'modeShape' implicitly has an 'any' type... Remove this comment to see the full error message
  setOppositeModeState = (modeShape, addToArchivedTracings) =>
    this.addToShownTracings(modeShape, !addToArchivedTracings);

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'modeShape' implicitly has an 'any' type... Remove this comment to see the full error message
  addToShownTracings = (modeShape, addToArchivedTracings) => {
    const mode = addToArchivedTracings ? "archivedModeState" : "unarchivedModeState";
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '(prevState: Readonly<State>) => ... Remove this comment to see the full error message
    this.setState((prevState) => {
      const newSubState = {
        // $FlowIssue[exponential-spread] See https://github.com/facebook/flow/issues/8299
        ...prevState[mode],
        ...modeShape,
      };
      return {
        // $FlowIssue[invalid-computed-prop] See https://github.com/facebook/flow/issues/8299
        [mode]: newSubState,
      };
    });
  };

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'pageNumber' implicitly has an 'any' typ... Remove this comment to see the full error message
  fetchNextPage = async (pageNumber) => {
    // this refers not to the pagination of antd but to the pagination of querying data from SQL
    const showArchivedTracings = this.state.shouldShowArchivedTracings;
    const previousTracings = this.getCurrentModeState().tracings;

    if (this.getCurrentModeState().loadedAllTracings) {
      return;
    }

    try {
      this.setState({
        isLoading: true,
      });
      const tracings =
        this.props.userId != null
          ? await getCompactAnnotationsForUser(this.props.userId, showArchivedTracings, pageNumber)
          : await getCompactAnnotations(showArchivedTracings, pageNumber);
      this.setModeState(
        {
          // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
          tracings: previousTracings.concat(tracings),
          lastLoadedPage: pageNumber,
          loadedAllTracings: tracings.length !== pageLength || tracings.length === 0,
        },
        showArchivedTracings,
      );
    } catch (error) {
      handleGenericError(error);
    } finally {
      this.setState({
        isLoading: false,
      });
    }
  };

  toggleShowArchived = () => {
    this.setState(
      (prevState) => ({
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

    const newTracings = this.getCurrentTracings().filter((t) => t.id !== tracing.id);
    const { shouldShowArchivedTracings } = this.state;

    if (type === "finish") {
      this.setModeState(
        {
          tracings: newTracings,
        },
        shouldShowArchivedTracings,
      );
      this.setOppositeModeState(
        {
          tracings: [newTracing].concat(this.state.archivedModeState.tracings),
        },
        shouldShowArchivedTracings,
      );
    } else {
      this.setModeState(
        {
          tracings: newTracings,
        },
        shouldShowArchivedTracings,
      );
      this.setOppositeModeState(
        {
          tracings: [newTracing].concat(this.state.unarchivedModeState.tracings),
        },
        shouldShowArchivedTracings,
      );
    }
  };

  renderActions = (tracing: APIAnnotationCompact) => {
    if (tracing.typ !== "Explorational") {
      return null;
    }

    const hasVolumeTracing = getVolumeDescriptors(tracing).length > 0;
    const { typ, id, state } = tracing;

    if (state === "Active") {
      return (
        <div>
          <Link to={`/annotations/${typ}/${id}`}>
            <PlayCircleOutlined />
            Trace
          </Link>
          <br />
          <AsyncLink
            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: string; href: string; onClick: (... Remove this comment to see the full error message
            href="#"
            onClick={() => downloadNml(id, typ, hasVolumeTracing)}
            icon={<DownloadOutlined key="download" />}
          >
            Download
          </AsyncLink>
          <br />
          <AsyncLink
            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: string; href: string; onClick: (... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: string; href: string; onClick: (... Remove this comment to see the full error message
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

  handleSearch = (event: React.SyntheticEvent): void => {
    this.setState({
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'EventTarg... Remove this comment to see the full error message
      searchQuery: event.target.value,
    });
  };

  renameTracing(tracing: APIAnnotationCompact, name: string) {
    const tracings = this.getCurrentTracings();
    const newTracings = tracings.map((currentTracing) => {
      if (currentTracing.id !== tracing.id) {
        return currentTracing;
      } else {
        return update(currentTracing, {
          name: {
            $set: name,
          },
        });
      }
    });
    this.setModeState(
      {
        tracings: newTracings,
      },
      this.state.shouldShowArchivedTracings,
    );
    editAnnotation(tracing.id, tracing.typ, {
      name,
    }).then(() => {
      Toast.success(messages["annotation.was_edited"]);
    });
  }

  archiveAll = () => {
    const selectedAnnotations = this.getFilteredTracings();
    Modal.confirm({
      content: `Are you sure you want to archive all ${selectedAnnotations.length} explorative annotations matching the current search query / tags?`,
      onOk: async () => {
        const selectedAnnotationIds = selectedAnnotations.map((t) => t.id);
        const data = await finishAllAnnotations(selectedAnnotationIds);
        Toast.messages(data.messages);
        this.setState((prevState) => ({
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
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string' is not assignable to par... Remove this comment to see the full error message
    if (!this.state.tags.includes(tag)) {
      this.setState((prevState) => ({
        tags: [...prevState.tags, tag],
      }));
    }
  };

  editTagFromAnnotation = (
    annotation: APIAnnotationCompact,
    shouldAddTag: boolean,
    tag: string,
    event: React.SyntheticEvent,
  ): void => {
    event.stopPropagation(); // prevent the onClick event

    this.setState((prevState) => {
      const newTracings = prevState.unarchivedModeState.tracings.map((t) => {
        let newAnnotation = t;

        if (t.id === annotation.id) {
          if (shouldAddTag) {
            // add the tag to an annotation
            if (!t.tags.includes(tag)) {
              newAnnotation = update(t, {
                tags: {
                  $push: [tag],
                },
              });
            }
          } else {
            // remove the tag from an annotation
            const newTags = _.without(t.tags, tag);

            newAnnotation = update(t, {
              tags: {
                $set: newTags,
              },
            });
          }

          // persist to server
          editAnnotation(newAnnotation.id, newAnnotation.typ, {
            tags: newAnnotation.tags,
          });
          trackAction("Edit annotation tag");
        }

        return newAnnotation;
      });
      return {
        unarchivedModeState: { ...prevState.unarchivedModeState, tracings: newTracings },
      };
    });
  };

  handleSearchPressEnter = (event: React.SyntheticEvent) => {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'EventTarg... Remove this comment to see the full error message
    const { value } = event.target;

    if (value !== "") {
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'EventTarg... Remove this comment to see the full error message
      this.addTagToSearch(event.target.value);
      this.setState({
        searchQuery: "",
      });
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
        onChange={(newName) => this.renameTracing(tracing, newName)}
        label="Annotation Name"
        description={tracing.description}
      />
    );
  }

  renderTable() {
    const filteredAndSortedTracings = this.getFilteredTracings().sort(
      Utils.compareBy(typeHint, (annotation) => annotation.modified, false),
    );
    return (
      <Table
        dataSource={filteredAndSortedTracings}
        rowKey="id"
        pagination={{
          defaultPageSize: 50,
        }}
        className="large-table"
        scroll={{
          x: "max-content",
        }}
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
          sorter={Utils.localeCompareBy(typeHint, (annotation) => annotation.id)}
          className="monospace-id"
        />
        <Column
          title="Name"
          width={280}
          dataIndex="name"
          sorter={Utils.localeCompareBy(typeHint, (annotation) => annotation.name)}
          render={(name: string, tracing: APIAnnotationCompact) =>
            this.renderNameWithDescription(tracing)
          }
        />
        <Column
          title="Stats"
          width={150}
          render={(
            __,
            annotation: APIAnnotationCompact, // Flow doesn't recognize that stats must contain the nodeCount if the treeCount is != null
          ) =>
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'treeCount' does not exist on type '{} | ... Remove this comment to see the full error message
            annotation.stats.treeCount != null &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'nodeCount' does not exist on type '{} | ... Remove this comment to see the full error message
            annotation.stats.nodeCount != null &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'edgeCount' does not exist on type '{} | ... Remove this comment to see the full error message
            annotation.stats.edgeCount != null ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "30% auto",
                }}
              >
                <span
                  title="Trees"
                  style={{
                    margin: "auto",
                  }}
                >
                  <i className="fas fa-sitemap" />
                </span>
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'treeCount' does not exist on type '{} | ... Remove this comment to see the full error message
                <span>{annotation.stats.treeCount}</span>
                <span
                  title="Nodes"
                  style={{
                    margin: "auto",
                  }}
                >
                  <i className="fas fa-circle fa-sm" />
                </span>
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'nodeCount' does not exist on type '{} | ... Remove this comment to see the full error message
                <span>{annotation.stats.nodeCount}</span>
                <span
                  title="Edges"
                  style={{
                    margin: "auto",
                  }}
                >
                  <i className="fas fa-arrows-alt-h" />
                </span>
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'edgeCount' does not exist on type '{} | ... Remove this comment to see the full error message
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
              {tags.map((tag) => (
                <CategorizationLabel
                  key={tag}
                  kind="annotations"
                  onClick={_.partial(this.addTagToSearch, tag)}
                  // @ts-expect-error ts-migrate(2322) FIXME: Type 'Function1<SyntheticEvent<Element, Event>, vo... Remove this comment to see the full error message
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
          sorter={Utils.compareBy(typeHint, (annotation) => annotation.modified)}
          render={(modified) => <FormattedDate timestamp={modified} />}
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
        setTags={(tags) =>
          this.setState({
            tags,
          })
        }
        localStorageSavingKey="lastDashboardSearchTags"
      />
    );
  }

  render() {
    const marginRight = {
      marginRight: 8,
    };
    const search = (
      <Search
        style={{
          width: 200,
          float: "right",
        }}
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
        <div
          className="clearfix"
          style={{
            margin: "20px 0px",
          }}
        />
        <Spin spinning={this.state.isLoading} size="large">
          {this.renderTable()}
        </Spin>
        <div
          style={{
            textAlign: "right",
          }}
        >
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

// @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'typeof ExplorativeAnnotationsVie... Remove this comment to see the full error message
export default withRouter(ExplorativeAnnotationsView);
