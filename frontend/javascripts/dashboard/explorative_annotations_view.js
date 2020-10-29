// @flow
import { Link, type RouterHistory, withRouter } from "react-router-dom";
import { PropTypes } from "@scalableminds/prop-types";
import { Spin, Input, Table, Button, Modal, Tag, Icon } from "antd";
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
import { formatHash, stringToColor } from "libs/format_utils";
import { handleGenericError } from "libs/error_handling";
import { setDropzoneModalVisibilityAction } from "oxalis/model/actions/ui_actions";
import EditableTextIcon from "oxalis/view/components/editable_text_icon";
import FormattedDate from "components/formatted_date";
import Persistence from "libs/persistence";
import Store from "oxalis/store";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import messages from "messages";
import { trackAction } from "oxalis/model/helpers/analytics";
import UserLocalStorage from "libs/user_local_storage";
import TextWithDescription from "components/text_with_description";

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

  componentWillMount() {
    this.setState(persistence.load(this.props.history));
  }

  componentDidMount() {
    this.restoreSearchTags();
    this.fetchNextPage(0);
  }

  componentWillUpdate(nextProps, nextState) {
    persistence.persist(this.props.history, nextState);
  }

  restoreSearchTags() {
    // restore the search query tags from the last session
    const searchTagString = UserLocalStorage.getItem("lastDashboardSearchTags");
    if (searchTagString) {
      try {
        const searchTags = JSON.parse(searchTagString);
        this.setState({ tags: searchTags });
      } catch (error) {
        // pass
      }
    }
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
    const hasVolumeTracing = tracing.tracing.volume != null;
    const { typ, id } = tracing;
    if (!this.state.shouldShowArchivedTracings) {
      return (
        <div>
          <Link to={`/annotations/${typ}/${id}`}>
            <Icon type="play-circle-o" />
            Trace
          </Link>
          <br />
          <AsyncLink href="#" onClick={() => downloadNml(id, typ, hasVolumeTracing)}>
            <Icon type="download" />
            Download
          </AsyncLink>
          <br />
          <AsyncLink href="#" onClick={() => this.finishOrReopenTracing("finish", tracing)}>
            <Icon type="inbox" />
            Archive
          </AsyncLink>
          <br />
        </div>
      );
    } else {
      return (
        <div>
          <AsyncLink href="#" onClick={() => this.finishOrReopenTracing("reopen", tracing)}>
            <Icon type="folder-open" />
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
      this.setState(prevState => {
        const newTags = update(prevState.tags, { $push: [tag] });
        UserLocalStorage.setItem("lastDashboardSearchTags", JSON.stringify(newTags));
        return { tags: newTags };
      });
    }
  };

  removeTagFromSearch = (tag: string): void => {
    this.setState(prevState => {
      const newTags = prevState.tags.filter(t => t !== tag);
      UserLocalStorage.setItem("lastDashboardSearchTags", JSON.stringify(newTags));
      return { tags: newTags };
    });
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

  renderNameWithDescription(tracing: APIAnnotationCompact) {
    return (
      <TextWithDescription
        isEditable
        value={tracing.name}
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
          render={(__, tracing: APIAnnotationCompact) => formatHash(tracing.id)}
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
            annotation.stats.edgeCount != null &&
            annotation.tracing.skeleton != null ? (
              <div>
                <span title="Trees">
                  <i className="fas fa-sitemap" />
                  {annotation.stats.treeCount}
                </span>
                <br />
                <span title="Nodes">
                  <i className="fas fa-circle fa-sm" />
                  {annotation.stats.nodeCount}
                </span>
                <br />
                <span title="Edges">
                  <i className="fas fa-arrows-alt-h" />
                  {annotation.stats.edgeCount}
                </span>
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
                <Tag
                  key={tag}
                  color={stringToColor(tag)}
                  onClick={_.partial(this.addTagToSearch, tag)}
                  onClose={_.partial(this.editTagFromAnnotation, annotation, false, tag)}
                  closable={
                    !(tag === annotation.dataSetName || AnnotationContentTypes.includes(tag)) &&
                    !this.state.shouldShowArchivedTracings
                  }
                >
                  {tag}
                </Tag>
              ))}
              {this.state.shouldShowArchivedTracings ? null : (
                <EditableTextIcon
                  icon="plus"
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
    return this.state.tags.map(tag => (
      <Tag
        key={tag}
        color={stringToColor(tag)}
        onClose={_.partial(this.removeTagFromSearch, tag)}
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
            <Button
              icon="upload"
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
        <h3>My Annotations</h3>
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
