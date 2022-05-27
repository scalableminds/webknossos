import { RouteComponentProps, Link, withRouter } from "react-router-dom";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module '@sca... Remove this comment to see the full error message
import { PropTypes } from "@scalableminds/prop-types";
import { Spin, Input, Table, Button, Modal, Tooltip, Tag } from "antd";
import {
  DownloadOutlined,
  FolderOpenOutlined,
  InboxOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  UploadOutlined,
  CopyOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import * as React from "react";
import _ from "lodash";
import update from "immutability-helper";
import { AsyncLink } from "components/async_clickables";
import { annotationToCompact, APIAnnotationCompact, APIUser } from "types/api_flow_types";
import { AnnotationContentTypes } from "oxalis/constants";
import {
  finishAllAnnotations,
  editAnnotation,
  finishAnnotation,
  reOpenAnnotation,
  downloadAnnotation,
  getCompactAnnotationsForUser,
  getReadableAnnotations,
} from "admin/admin_rest_api";
import { formatHash, stringToColor } from "libs/format_utils";
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
  history: RouteComponentProps["history"];
  activeUser: APIUser;
};
type State = {
  shouldShowArchivedTracings: boolean;
  archivedModeState: TracingModeState;
  unarchivedModeState: TracingModeState;
  searchQuery: string;
  tags: Array<string>;
  isLoading: boolean;
};
type PartialState = Pick<State, "searchQuery" | "shouldShowArchivedTracings">;
const persistence = new Persistence<PartialState>(
  {
    searchQuery: PropTypes.string,
    shouldShowArchivedTracings: PropTypes.bool,
  },
  "explorativeList",
);

const READ_ONLY_ICON = (
  <span className="fa-stack fa-1x">
    <i className="fas fa-pen fa-stack-1x" />
    <i className="fas fa-slash fa-stack-1x" />
  </span>
);

function formatUserName(user: APIUser) {
  return `${user.firstName} ${user.lastName}`;
}

class ExplorativeAnnotationsView extends React.PureComponent<Props, State> {
  state: State = {
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
    this.setState(persistence.load(this.props.history) as PartialState, () => {
      this.fetchNextPage(0);
    });
  }

  componentDidUpdate(_prevProps: Props, prevState: State) {
    persistence.persist(this.props.history, this.state);

    if (this.state.shouldShowArchivedTracings !== prevState.shouldShowArchivedTracings) {
      this.fetchNextPage(0);
    }
  }

  getCurrentModeState = () =>
    this.state.shouldShowArchivedTracings
      ? this.state.archivedModeState
      : this.state.unarchivedModeState;

  setModeState = (modeShape: Partial<TracingModeState>, addToArchivedTracings: boolean) =>
    this.addToShownTracings(modeShape, addToArchivedTracings);

  setOppositeModeState = (modeShape: Partial<TracingModeState>, addToArchivedTracings: boolean) =>
    this.addToShownTracings(modeShape, !addToArchivedTracings);

  addToShownTracings = (modeShape: Partial<TracingModeState>, addToArchivedTracings: boolean) => {
    const mode = addToArchivedTracings ? "archivedModeState" : "unarchivedModeState";
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '(prevState: Readonly<State>) => ... Remove this comment to see the full error message
    this.setState((prevState) => {
      const newSubState = {
        ...prevState[mode],
        ...modeShape,
      };
      return {
        [mode]: newSubState,
      };
    });
  };

  fetchNextPage = async (pageNumber: number) => {
    // this does not refer to the pagination of antd but to the pagination of querying data from SQL
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
          ? // todo: also implement pendant for getCompactAnnotationsForUser ?
            await getCompactAnnotationsForUser(this.props.userId, showArchivedTracings, pageNumber)
          : await getReadableAnnotations(showArchivedTracings, pageNumber);

      this.setModeState(
        {
          tracings: previousTracings.concat(tracings),
          lastLoadedPage: pageNumber,
          loadedAllTracings: tracings.length !== pageLength || tracings.length === 0,
        },
        showArchivedTracings,
      );
    } catch (error) {
      handleGenericError(error as Error);
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
    const newTracing = annotationToCompact(
      type === "finish"
        ? await finishAnnotation(tracing.id, tracing.typ)
        : await reOpenAnnotation(tracing.id, tracing.typ),
    );

    if (type === "finish") {
      Toast.success(messages["annotation.was_finished"]);
    } else {
      Toast.success(messages["annotation.was_re_opened"]);
    }

    const newTracings = this.getCurrentOwnTracings().filter((t) => t.id !== tracing.id);
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
            Open
          </Link>
          <br />
          <AsyncLink
            href="#"
            onClick={() => downloadAnnotation(id, typ, hasVolumeTracing)}
            icon={<DownloadOutlined key="download" />}
          >
            Download
          </AsyncLink>
          <br />
          {this.isTracingEditable(tracing) ? (
            <AsyncLink
              href="#"
              onClick={() => this.finishOrReopenTracing("finish", tracing)}
              icon={<InboxOutlined key="inbox" />}
            >
              Archive
            </AsyncLink>
          ) : null}
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

  getCurrentOwnTracings(): Array<APIAnnotationCompact> {
    return this.getCurrentModeState().tracings;
  }

  handleSearch = (event: React.SyntheticEvent): void => {
    this.setState({
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'EventTarg... Remove this comment to see the full error message
      searchQuery: event.target.value,
    });
  };

  renameTracing(tracing: APIAnnotationCompact, name: string) {
    const tracings = this.getCurrentOwnTracings();
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
    const selectedAnnotations = this.getAllFilteredTracings();
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

  getAllFilteredTracings() {
    const allTracings = _.uniqBy(this.getCurrentOwnTracings(), (annotation) => annotation.id);
    return Utils.filterWithSearchQueryAND(
      allTracings,
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
        {formatHash(tracing.id)}
      </div>
    );
  }

  renderNameWithDescription(tracing: APIAnnotationCompact) {
    return (
      <div style={{ color: tracing.name ? "inherit" : "#7c7c7c" }}>
        <TextWithDescription
          isEditable={this.isTracingEditable(tracing)}
          value={tracing.name ? tracing.name : "Unnamed Annotation"}
          onChange={(newName) => this.renameTracing(tracing, newName)}
          label="Annotation Name"
          description={tracing.description}
        />
      </div>
    );
  }

  isTracingEditable(tracing: APIAnnotationCompact): boolean {
    return tracing.owner?.id == this.props.activeUser.id;
  }

  renderTable() {
    const filteredAndSortedTracings = this.getAllFilteredTracings().sort(
      Utils.compareBy(typeHint, (annotation) => annotation.modified, false),
    );
    const renderOwner = (owner: APIUser) => {
      if (!this.props.isAdminView && owner.id == this.props.activeUser.id) {
        return (
          <span>
            {formatUserName(owner)} <span style={{ color: "#7c7c7c" }}>(you)</span>
          </span>
        );
      }
      return formatUserName(owner);
    };

    const ownerFilters = _.uniqBy(
      // Prepend user's name to the front so that this is listed at the top
      [
        { formattedName: formatUserName(this.props.activeUser), id: this.props.activeUser.id },
      ].concat(
        _.compact(
          filteredAndSortedTracings.map((tracing) =>
            tracing.owner != null
              ? { formattedName: formatUserName(tracing.owner), id: tracing.owner.id }
              : null,
          ),
        ),
      ),
      "id",
    ).map(({ formattedName, id }) => ({ text: formattedName, value: id }));
    const teamFilters = _.uniqBy(
      _.flatMap(filteredAndSortedTracings, (tracing) => tracing.teams),
      "id",
    ).map((team) => ({ text: team.name, value: team.id }));

    const ownerAndTeamsFilters = [
      {
        text: "Owners",
        value: "OwnersFilter",
        children: ownerFilters,
      },
      {
        text: "Teams",
        value: "TeamsFilter",
        children: teamFilters,
      },
    ];

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
          render={(__, tracing: APIAnnotationCompact) => (
            <>
              <div className="monospace-id">{this.renderIdAndCopyButton(tracing)}</div>

              {!this.isTracingEditable(tracing) ? (
                <div style={{ color: "#7c7c7c" }}>
                  {READ_ONLY_ICON}
                  read-only
                </div>
              ) : null}
            </>
          )}
          sorter={Utils.localeCompareBy(typeHint, (annotation) => annotation.id)}
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
          title="Owner & Teams"
          dataIndex="owner"
          width={200}
          filters={ownerAndTeamsFilters}
          filterMode="tree"
          onFilter={(value: string | number | boolean, tracing: APIAnnotationCompact) =>
            (tracing.owner != null && tracing.owner.id == value.toString()) ||
            tracing.teams.some((team) => team.id === value)
          }
          sorter={Utils.localeCompareBy(
            typeHint,
            (annotation) => annotation.owner?.firstName || "",
          )}
          render={(owner: APIUser | null, tracing: APIAnnotationCompact) => {
            const ownerName = owner != null ? renderOwner(owner) : null;
            const teamTags = tracing.teams.map((t) => (
              <Tag key={t.id} color={stringToColor(t.name)}>
                {t.name}
              </Tag>
            ));

            return (
              <>
                <div>
                  <UserOutlined />
                  {ownerName}
                </div>
                {teamTags.length > 0 ? <TeamOutlined /> : null}
                {teamTags}
              </>
            );
          }}
        />
        <Column
          title="Stats"
          width={150}
          render={(__, annotation: APIAnnotationCompact) =>
            "treeCount" in annotation.stats &&
            "nodeCount" in annotation.stats &&
            "edgeCount" in annotation.stats ? (
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
                <span>{annotation.stats.treeCount}</span>
                <span
                  title="Nodes"
                  style={{
                    margin: "auto",
                  }}
                >
                  <i className="fas fa-circle fa-sm" />
                </span>
                <span>{annotation.stats.nodeCount}</span>
                <span
                  title="Edges"
                  style={{
                    margin: "auto",
                  }}
                >
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

export default withRouter<RouteComponentProps & Props, any>(ExplorativeAnnotationsView);
