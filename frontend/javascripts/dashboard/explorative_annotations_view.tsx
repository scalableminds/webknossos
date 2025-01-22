import {
  CopyOutlined,
  DownloadOutlined,
  FolderOpenOutlined,
  InboxOutlined,
  LockOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  TeamOutlined,
  UnlockOutlined,
  UploadOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { PropTypes } from "@scalableminds/prop-types";
import {
  downloadAnnotation,
  editAnnotation,
  editLockedState,
  finishAllAnnotations,
  finishAnnotation,
  getCompactAnnotationsForUser,
  getReadableAnnotations,
  reOpenAnnotation,
} from "admin/admin_rest_api";
import {
  Button,
  Card,
  Col,
  Input,
  Modal,
  Row,
  Spin,
  Table,
  type TableProps,
  Tag,
  Tooltip,
} from "antd";
import type { SearchProps } from "antd/lib/input";
import { AsyncLink } from "components/async_clickables";
import FormattedDate from "components/formatted_date";
import TextWithDescription from "components/text_with_description";
import update from "immutability-helper";
import { handleGenericError } from "libs/error_handling";
import { formatHash, stringToColor } from "libs/format_utils";
import Persistence from "libs/persistence";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import _ from "lodash";
import messages from "messages";
import { AnnotationContentTypes } from "oxalis/constants";
import { getCombinedStatsFromServerAnnotation } from "oxalis/model/accessors/annotation_accessor";
import { getVolumeDescriptors } from "oxalis/model/accessors/volumetracing_accessor";
import { setDropzoneModalVisibilityAction } from "oxalis/model/actions/ui_actions";
import Store from "oxalis/store";
import CategorizationLabel, {
  CategorizationSearch,
} from "oxalis/view/components/categorization_label";
import EditableTextIcon from "oxalis/view/components/editable_text_icon";
import { RenderToPortal } from "oxalis/view/layouting/portal_utils";
import { AnnotationStats } from "oxalis/view/right-border-tabs/dataset_info_tab_view";
import * as React from "react";
import { Link } from "react-router-dom";
import {
  type APIAnnotationInfo,
  type APIUser,
  type APIUserCompact,
  annotationToCompact,
} from "types/api_flow_types";
import { ActiveTabContext, RenderingTabContext } from "./dashboard_contexts";

const { Search } = Input;
const pageLength: number = 1000;

type TracingModeState = {
  tracings: Array<APIAnnotationInfo>;
  lastLoadedPage: number;
  loadedAllTracings: boolean;
};
type Props = {
  userId: string | null | undefined;
  isAdminView: boolean;
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

function formatUserName(user: APIUserCompact) {
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

  // This attribute is not part of the state, since it is only set in the
  // summary-prop of <Table /> which is called by antd on render.
  // Other than that, the value should not be changed. It can be used to
  // retrieve the items of the currently rendered page (while respecting
  // the active search and filters).
  currentPageData: Readonly<APIAnnotationInfo[]> = [];

  componentDidMount() {
    this.setState(persistence.load() as PartialState, () => {
      this.fetchNextPage(0);
    });
  }

  componentDidUpdate(_prevProps: Props, prevState: State) {
    persistence.persist(this.state);

    if (this.state.shouldShowArchivedTracings !== prevState.shouldShowArchivedTracings) {
      this.fetchNextPage(0);
    }
  }

  getCurrentModeState = () => this.getModeState(this.state.shouldShowArchivedTracings);

  getModeState = (useArchivedTracings: boolean) => {
    if (useArchivedTracings) {
      return this.state.archivedModeState;
    } else {
      return this.state.unarchivedModeState;
    }
  };

  updateTracingInLocalState = (
    tracing: APIAnnotationInfo,
    callback: (arg0: APIAnnotationInfo) => APIAnnotationInfo,
  ) => {
    const tracings = this.getCurrentTracings();
    const newTracings = tracings.map((currentTracing) =>
      currentTracing.id !== tracing.id ? currentTracing : callback(currentTracing),
    );
    this.setModeState({ tracings: newTracings }, this.state.shouldShowArchivedTracings);
  };

  setModeState = (modeShape: Partial<TracingModeState>, useArchivedTracings: boolean) =>
    this.addToShownTracings(modeShape, useArchivedTracings);

  addToShownTracings = (modeShape: Partial<TracingModeState>, useArchivedTracings: boolean) => {
    const mode = useArchivedTracings ? "archivedModeState" : "unarchivedModeState";
    this.setState((prevState) => {
      const newSubState = {
        ...prevState[mode],
        ...modeShape,
      };
      return {
        ...prevState,
        [mode]: newSubState,
      };
    });
  };

  fetchNextPage = async (pageNumber: number) => {
    // this does not refer to the pagination of antd but to the pagination of querying data from SQL
    const showArchivedTracings = this.state.shouldShowArchivedTracings;
    const currentModeState = this.getCurrentModeState();
    const previousTracings = currentModeState.tracings;

    if (currentModeState.loadedAllTracings || pageNumber <= currentModeState.lastLoadedPage) {
      return;
    }

    try {
      this.setState({
        isLoading: true,
      });

      const tracings =
        this.props.userId != null
          ? // If an administrator views the dashboard of a specific user, we only fetch the annotations of that user.
            await getCompactAnnotationsForUser(this.props.userId, showArchivedTracings, pageNumber)
          : await getReadableAnnotations(showArchivedTracings, pageNumber);

      this.setModeState(
        {
          // If the user archives a tracing, the tracing is already moved to the archived
          // state. Switching to the archived tab for the first time, will download the annotation
          // again which is why we need to deduplicate here.
          tracings: _.uniqBy(previousTracings.concat(tracings), (tracing) => tracing.id),
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

  finishOrReopenAnnotation = async (type: "finish" | "reopen", tracing: APIAnnotationInfo) => {
    const shouldFinish = type === "finish";
    const newTracing = annotationToCompact(
      shouldFinish
        ? await finishAnnotation(tracing.id, tracing.typ)
        : await reOpenAnnotation(tracing.id, tracing.typ),
    );

    if (shouldFinish) {
      Toast.success(messages["annotation.was_finished"]);
    } else {
      Toast.success(messages["annotation.was_re_opened"]);
    }

    // If the annotation was finished, update the not finished list
    // (and vice versa).
    const newTracings = this.getModeState(!shouldFinish).tracings.filter(
      (t) => t.id !== tracing.id,
    );
    this.setModeState(
      {
        tracings: newTracings,
      },
      !shouldFinish,
    );

    // If the annotation was finished, add it to the finished list
    // (and vice versa).
    const existingTracings = this.getModeState(shouldFinish).tracings;
    this.setModeState(
      {
        tracings: [newTracing].concat(existingTracings),
      },
      shouldFinish,
    );
  };

  _updateAnnotationWithArchiveAction = (
    annotation: APIAnnotationInfo,
    type: "finish" | "reopen",
  ): APIAnnotationInfo => ({
    ...annotation,
    state: type === "reopen" ? "Active" : "Finished",
  });

  setLockedState = async (tracing: APIAnnotationInfo, locked: boolean) => {
    try {
      const newTracing = await editLockedState(tracing.id, tracing.typ, locked);
      Toast.success(messages["annotation.was_edited"]);
      this.updateTracingInLocalState(tracing, (_t) => newTracing);
    } catch (error) {
      handleGenericError(error as Error, "Could not update the annotation lock state.");
    }
  };

  renderActions = (tracing: APIAnnotationInfo) => {
    if (tracing.typ !== "Explorational") {
      return null;
    }
    const isActiveUserOwner = tracing.owner?.id === this.props.activeUser.id;

    const { typ, id, state } = tracing;

    if (state === "Active") {
      return (
        <div>
          <Link to={`/annotations/${id}`}>
            <PlayCircleOutlined className="icon-margin-right" />
            Open
          </Link>
          <br />
          <AsyncLink
            href="#"
            onClick={() => {
              const hasVolumeTracing = getVolumeDescriptors(tracing).length > 0;
              return downloadAnnotation(id, typ, hasVolumeTracing);
            }}
            icon={<DownloadOutlined key="download" className="icon-margin-right" />}
          >
            Download
          </AsyncLink>
          {this.isTracingEditable(tracing) ? (
            <>
              <br />
              <AsyncLink
                href="#"
                onClick={() => this.finishOrReopenAnnotation("finish", tracing)}
                icon={<InboxOutlined key="inbox" className="icon-margin-right" />}
                disabled={tracing.isLockedByOwner}
                title={
                  tracing.isLockedByOwner ? "Locked annotations cannot be archived." : undefined
                }
              >
                Archive
              </AsyncLink>
            </>
          ) : null}
          {isActiveUserOwner ? (
            <>
              <br />
              <AsyncLink
                href="#"
                onClick={() => this.setLockedState(tracing, !tracing.isLockedByOwner)}
                icon={
                  tracing.isLockedByOwner ? (
                    <LockOutlined key="lock" className="icon-margin-right" />
                  ) : (
                    <UnlockOutlined key="unlock" className="icon-margin-right" />
                  )
                }
              >
                {tracing.isLockedByOwner ? "Unlock" : "Lock"}
              </AsyncLink>
            </>
          ) : null}
        </div>
      );
    } else {
      return (
        <div>
          <AsyncLink
            href="#"
            onClick={() => this.finishOrReopenAnnotation("reopen", tracing)}
            icon={<FolderOpenOutlined key="folder" className="icon-margin-right" />}
          >
            Reopen
          </AsyncLink>
          <br />
        </div>
      );
    }
  };

  getCurrentTracings(): Array<APIAnnotationInfo> {
    return this.getCurrentModeState().tracings;
  }

  handleSearchChanged = (event: React.ChangeEvent<HTMLInputElement>): void => {
    this.setState({
      searchQuery: event.target.value,
    });
  };

  renameTracing(tracing: APIAnnotationInfo, name: string) {
    editAnnotation(tracing.id, tracing.typ, { name })
      .then(() => {
        Toast.success(messages["annotation.was_edited"]);
        this.updateTracingInLocalState(tracing, (t) => update(t, { name: { $set: name } }));
      })
      .catch((error) => {
        handleGenericError(error as Error, "Could not update the annotation name.");
      });
  }

  archiveAll = () => {
    const selectedAnnotations = this.currentPageData.filter(
      (annotation: APIAnnotationInfo) => annotation.owner?.id === this.props.activeUser.id,
    );

    if (selectedAnnotations.length === 0) {
      Toast.info(
        "No annotations available to archive. Note that you can only archive annotations that you own.",
      );
      return;
    }

    Modal.confirm({
      content: `Are you sure you want to archive ${selectedAnnotations.length} explorative annotations matching the current search query / tags? Note that annotations that you don't own are ignored.`,
      onOk: async () => {
        const selectedAnnotationIds = selectedAnnotations.map((t) => t.id);
        const data = await finishAllAnnotations(selectedAnnotationIds);
        Toast.messages(data.messages);
        this.setState((prevState) => ({
          archivedModeState: {
            ...prevState.archivedModeState,
            tracings: prevState.archivedModeState.tracings.concat(
              selectedAnnotations.map((annotation) =>
                this._updateAnnotationWithArchiveAction(annotation, "finish"),
              ),
            ),
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
    annotation: APIAnnotationInfo,
    shouldAddTag: boolean,
    tag: string,
    event?: React.SyntheticEvent,
  ): void => {
    event?.stopPropagation(); // prevent the onClick event

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
        }

        return newAnnotation;
      });
      return {
        unarchivedModeState: { ...prevState.unarchivedModeState, tracings: newTracings },
      };
    });
  };

  getEmptyListPlaceholder = () => {
    return this.state.isLoading ? null : (
      <Row gutter={32} justify="center" style={{ padding: 50 }}>
        <Col span="6">
          <Card
            bordered={false}
            cover={
              <div style={{ display: "flex", justifyContent: "center" }}>
                <i className="drawing drawing-empty-list-annotations" />
              </div>
            }
            style={{ background: "transparent" }}
          >
            <Card.Meta
              title="Create an Annotation"
              style={{ textAlign: "center" }}
              description={
                <>
                  <p>Create your first annotation by opening a dataset from the datasets page.</p>
                  <Link to="/dashboard/datasets">
                    <Button type="primary" style={{ marginTop: 30 }}>
                      Open Datasets Page
                    </Button>
                  </Link>
                </>
              }
            />
          </Card>
        </Col>
      </Row>
    );
  };

  handleOnSearch: SearchProps["onSearch"] = (value, _event) => {
    if (value !== "") {
      this.addTagToSearch(value);
      this.setState({
        searchQuery: "",
      });
    }
  };

  _getSearchFilteredTracings() {
    // Note, this method should only be used to pass tracings
    // to the antd table. Antd itself can apply additional filters
    // (e.g., filtering by owner in the column header).
    // Use `this.currentPageData` if you need all currently visible
    // items of the active page.
    const filteredTracings = Utils.filterWithSearchQueryAND(
      this.getCurrentTracings(),
      ["id", "name", "modified", "tags", "owner"],
      this.state.searchQuery,
    );

    if (this.state.tags.length === 0) {
      // This check is not strictly necessary, but serves
      // as an early-out to save some computations.
      return filteredTracings;
    }

    return filteredTracings.filter((el) => _.intersection(this.state.tags, el.tags).length > 0);
  }

  renderIdAndCopyButton(tracing: APIAnnotationInfo) {
    const copyIdToClipboard = async () => {
      await navigator.clipboard.writeText(tracing.id);
      Toast.success("ID copied to clipboard");
    };

    return (
      <div>
        <Tooltip title="Copy long ID" placement="bottom">
          <Button
            onClick={copyIdToClipboard}
            icon={<CopyOutlined />}
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

  renderNameWithDescription(tracing: APIAnnotationInfo) {
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

  isTracingEditable(tracing: APIAnnotationInfo): boolean {
    return tracing.owner?.id === this.props.activeUser.id || tracing.othersMayEdit;
  }

  renderTable() {
    const filteredAndSortedTracings = this._getSearchFilteredTracings().sort(
      Utils.compareBy<APIAnnotationInfo>((annotation) => annotation.modified, false),
    );
    const renderOwner = (owner: APIUser) => {
      if (!this.props.isAdminView && owner.id === this.props.activeUser.id) {
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

    if (filteredAndSortedTracings.length === 0) {
      return this.getEmptyListPlaceholder();
    }

    const disabledColor = { color: "var(--ant-color-text-disabled)" };
    const columns: TableProps["columns"] = [
      {
        title: "ID",
        dataIndex: "id",
        width: 100,
        render: (__: any, tracing: APIAnnotationInfo) => (
          <>
            <div className="monospace-id">{this.renderIdAndCopyButton(tracing)}</div>

            {!this.isTracingEditable(tracing) ? (
              <div style={disabledColor}>{READ_ONLY_ICON} read-only</div>
            ) : null}
            {tracing.isLockedByOwner ? (
              <div style={disabledColor}>
                <LockOutlined style={{ marginLeft: 8, marginRight: 8 }} /> locked
              </div>
            ) : null}
          </>
        ),
        sorter: Utils.localeCompareBy((annotation) => annotation.id),
      },
      {
        title: "Name",
        width: 280,
        dataIndex: "name",
        sorter: Utils.localeCompareBy((annotation) => annotation.name),
        render: (_name: string, tracing: APIAnnotationInfo) =>
          this.renderNameWithDescription(tracing),
      },
      {
        title: "Owner & Teams",
        dataIndex: "owner",
        width: 300,
        filters: ownerAndTeamsFilters,
        filterMode: "tree",
        onFilter: (value: React.Key | boolean, tracing: APIAnnotationInfo) =>
          (tracing.owner != null && tracing.owner.id === value.toString()) ||
          tracing.teams.some((team) => team.id === value),
        sorter: Utils.localeCompareBy((annotation) => annotation.owner?.firstName || ""),
        render: (owner: APIUser | null, tracing: APIAnnotationInfo) => {
          const ownerName = owner != null ? renderOwner(owner) : null;
          const teamTags = tracing.teams.map((t) => (
            <Tag key={t.id} color={stringToColor(t.name)}>
              {t.name}
            </Tag>
          ));

          return (
            <>
              <div>
                <UserOutlined className="icon-margin-right" />
                {ownerName}
              </div>
              <div className="flex-container">
                <div className="flex-item" style={{ flexGrow: 0 }}>
                  {teamTags.length > 0 ? <TeamOutlined className="icon-margin-right" /> : null}
                </div>
                <div className="flex-item">{teamTags}</div>
              </div>
            </>
          );
        },
      },
      {
        title: "Stats",
        width: 150,
        render: (__: any, annotation: APIAnnotationInfo) => (
          <AnnotationStats
            stats={getCombinedStatsFromServerAnnotation(annotation)}
            asInfoBlock={false}
            withMargin={false}
          />
        ),
      },
      {
        title: "Tags",
        dataIndex: "tags",
        render: (tags: Array<string>, annotation: APIAnnotationInfo) => (
          <div>
            {tags.map((tag) => (
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
        ),
      },
      {
        title: "Modification Date",
        dataIndex: "modified",
        width: 200,
        sorter: Utils.compareBy<APIAnnotationInfo>((annotation) => annotation.modified),
        render: (modified) => <FormattedDate timestamp={modified} />,
      },
      {
        width: 200,
        fixed: "right",
        title: "Actions",
        className: "nowrap",
        key: "action",
        render: (__: any, tracing: APIAnnotationInfo) => this.renderActions(tracing),
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
        summary={(currentPageData) => {
          // See this issue for context:
          // https://github.com/ant-design/ant-design/issues/24022#issuecomment-1050070509
          // Currently, there is no other way to easily get the items which are rendered by
          // the table (while respecting the active filters).
          // Using <Table onChange={...} /> is not a solution. See this explanation:
          // https://github.com/ant-design/ant-design/issues/24022#issuecomment-691842572
          this.currentPageData = currentPageData;
          return null;
        }}
        columns={columns}
      />
    );
  }

  renderSearchTags() {
    return (
      <CategorizationSearch
        itemName="annotations"
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
    return (
      <div>
        <TopBar
          isAdminView={this.props.isAdminView}
          handleOnSearch={this.handleOnSearch}
          handleSearchChanged={this.handleSearchChanged}
          searchQuery={this.state.searchQuery}
          toggleShowArchived={this.toggleShowArchived}
          shouldShowArchivedTracings={this.state.shouldShowArchivedTracings}
          archiveAll={this.archiveAll}
        />
        {this.renderSearchTags()}
        <Spin spinning={this.state.isLoading} size="large" style={{ marginTop: 4 }}>
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

function TopBar({
  isAdminView,
  handleOnSearch,
  handleSearchChanged,
  searchQuery,
  toggleShowArchived,
  shouldShowArchivedTracings,
  archiveAll,
}: {
  isAdminView: boolean;
  handleOnSearch: SearchProps["onSearch"];
  handleSearchChanged: (event: React.ChangeEvent<HTMLInputElement>) => void;
  searchQuery: string;
  toggleShowArchived: () => void;
  shouldShowArchivedTracings: boolean;
  archiveAll: () => void;
}) {
  const activeTab = React.useContext(ActiveTabContext);
  const renderingTab = React.useContext(RenderingTabContext);

  const marginRight = {
    marginRight: 8,
  };
  const search = (
    <Search
      style={{
        width: 200,
        float: "right",
      }}
      onSearch={handleOnSearch}
      onChange={handleSearchChanged}
      value={searchQuery}
    />
  );

  const content = isAdminView ? (
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
      <Button onClick={toggleShowArchived} style={marginRight}>
        Show {shouldShowArchivedTracings ? "Open" : "Archived"} Annotations
      </Button>
      {!shouldShowArchivedTracings ? (
        <Button onClick={archiveAll} style={marginRight}>
          Archive All
        </Button>
      ) : null}
      {search}
    </div>
  );

  return (
    <RenderToPortal portalId="dashboard-TabBarExtraContent">
      {activeTab === renderingTab ? content : null}
    </RenderToPortal>
  );
}

export default ExplorativeAnnotationsView;
