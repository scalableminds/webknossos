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
} from "admin/rest_api";
import { Button, Card, Col, Input, Modal, Row, Spin, Table, Tag, Tooltip } from "antd";
import type { SearchProps } from "antd/lib/input";
import type { ColumnType } from "antd/lib/table/interface";
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
import * as React from "react";
import { Link } from "react-router-dom";
import {
  type APIAnnotationInfo,
  type APIUser,
  type APIUserCompact,
  annotationToCompact,
} from "types/api_types";
import { AnnotationContentTypes } from "viewer/constants";
import { getVolumeDescriptors } from "viewer/model/accessors/volumetracing_accessor";
import { setDropzoneModalVisibilityAction } from "viewer/model/actions/ui_actions";
import Store from "viewer/store";
import CategorizationLabel, {
  CategorizationSearch,
} from "viewer/view/components/categorization_label";
import EditableTextIcon from "viewer/view/components/editable_text_icon";
import { RenderToPortal } from "viewer/view/layouting/portal_utils";
import { AnnotationStats } from "viewer/view/right-border-tabs/dataset_info_tab_view";
import { ActiveTabContext, RenderingTabContext } from "./dashboard_contexts";

const { Search } = Input;
const pageLength: number = 1000;

type AnnotationModeState = {
  annotations: Array<APIAnnotationInfo>;
  lastLoadedPage: number;
  loadedAllAnnotations: boolean;
};
type Props = {
  userId: string | null | undefined;
  isAdminView: boolean;
  activeUser: APIUser;
};
type State = {
  shouldShowArchivedAnnotations: boolean;
  archivedModeState: AnnotationModeState;
  unarchivedModeState: AnnotationModeState;
  searchQuery: string;
  tags: Array<string>;
  isLoading: boolean;
};
type PartialState = Pick<State, "searchQuery" | "shouldShowArchivedAnnotations">;
const persistence = new Persistence<PartialState>(
  {
    searchQuery: PropTypes.string,
    shouldShowArchivedAnnotations: PropTypes.bool,
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
    shouldShowArchivedAnnotations: false,
    archivedModeState: {
      annotations: [],
      lastLoadedPage: -1,
      loadedAllAnnotations: false,
    },
    unarchivedModeState: {
      annotations: [],
      lastLoadedPage: -1,
      loadedAllAnnotations: false,
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

    if (this.state.shouldShowArchivedAnnotations !== prevState.shouldShowArchivedAnnotations) {
      this.fetchNextPage(0);
    }
  }

  getCurrentModeState = () => this.getModeState(this.state.shouldShowArchivedAnnotations);

  getModeState = (useArchivedAnnotations: boolean) => {
    if (useArchivedAnnotations) {
      return this.state.archivedModeState;
    } else {
      return this.state.unarchivedModeState;
    }
  };

  updateAnnotationInLocalState = (
    annotation: APIAnnotationInfo,
    callback: (arg0: APIAnnotationInfo) => APIAnnotationInfo,
  ) => {
    const annotations = this.getCurrentAnnotations();
    const newAnnotations = annotations.map((currentAnnotation) =>
      currentAnnotation.id !== annotation.id ? currentAnnotation : callback(currentAnnotation),
    );
    this.setModeState({ annotations: newAnnotations }, this.state.shouldShowArchivedAnnotations);
  };

  setModeState = (modeShape: Partial<AnnotationModeState>, useArchivedAnnotations: boolean) =>
    this.addToShownAnnotations(modeShape, useArchivedAnnotations);

  addToShownAnnotations = (
    modeShape: Partial<AnnotationModeState>,
    useArchivedAnnotations: boolean,
  ) => {
    const mode = useArchivedAnnotations ? "archivedModeState" : "unarchivedModeState";
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
    const showArchivedAnnotations = this.state.shouldShowArchivedAnnotations;
    const currentModeState = this.getCurrentModeState();
    const previousAnnotations = currentModeState.annotations;

    if (currentModeState.loadedAllAnnotations || pageNumber <= currentModeState.lastLoadedPage) {
      return;
    }

    try {
      this.setState({
        isLoading: true,
      });

      const annotations =
        this.props.userId != null
          ? // If an administrator views the dashboard of a specific user, we only fetch the annotations of that user.
            await getCompactAnnotationsForUser(
              this.props.userId,
              showArchivedAnnotations,
              pageNumber,
            )
          : await getReadableAnnotations(showArchivedAnnotations, pageNumber);

      this.setModeState(
        {
          // If the user archives a annotation, the annotation is already moved to the archived
          // state. Switching to the archived tab for the first time, will download the annotation
          // again which is why we need to deduplicate here.
          annotations: _.uniqBy(
            previousAnnotations.concat(annotations),
            (annotation) => annotation.id,
          ),
          lastLoadedPage: pageNumber,
          loadedAllAnnotations: annotations.length !== pageLength || annotations.length === 0,
        },
        showArchivedAnnotations,
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
        shouldShowArchivedAnnotations: !prevState.shouldShowArchivedAnnotations,
      }),
      () => {
        if (this.getCurrentModeState().lastLoadedPage === -1) this.fetchNextPage(0);
      },
    );
  };

  finishOrReopenAnnotation = async (type: "finish" | "reopen", annotation: APIAnnotationInfo) => {
    const shouldFinish = type === "finish";
    const newAnnotation = annotationToCompact(
      shouldFinish
        ? await finishAnnotation(annotation.id, annotation.typ)
        : await reOpenAnnotation(annotation.id, annotation.typ),
    );

    if (shouldFinish) {
      Toast.success(messages["annotation.was_finished"]);
    } else {
      Toast.success(messages["annotation.was_re_opened"]);
    }

    // If the annotation was finished, update the not finished list
    // (and vice versa).
    const newAnnotations = this.getModeState(!shouldFinish).annotations.filter(
      (t) => t.id !== annotation.id,
    );
    this.setModeState(
      {
        annotations: newAnnotations,
      },
      !shouldFinish,
    );

    // If the annotation was finished, add it to the finished list
    // (and vice versa).
    const existingAnnotations = this.getModeState(shouldFinish).annotations;
    this.setModeState(
      {
        annotations: [newAnnotation].concat(existingAnnotations),
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

  setLockedState = async (annotation: APIAnnotationInfo, locked: boolean) => {
    try {
      const newAnnotation = await editLockedState(annotation.id, annotation.typ, locked);
      Toast.success(messages["annotation.was_edited"]);
      this.updateAnnotationInLocalState(annotation, (_t) => newAnnotation);
    } catch (error) {
      handleGenericError(error as Error, "Could not update the annotation lock state.");
    }
  };

  renderActions = (annotation: APIAnnotationInfo) => {
    if (annotation.typ !== "Explorational") {
      return null;
    }
    const isActiveUserOwner = annotation.owner?.id === this.props.activeUser.id;

    const { typ, id, state } = annotation;

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
              const hasVolumeAnnotation = getVolumeDescriptors(annotation).length > 0;
              return downloadAnnotation(id, typ, hasVolumeAnnotation);
            }}
            icon={<DownloadOutlined key="download" className="icon-margin-right" />}
          >
            Download
          </AsyncLink>
          {this.isAnnotationEditable(annotation) ? (
            <>
              <br />
              <AsyncLink
                href="#"
                onClick={() => this.finishOrReopenAnnotation("finish", annotation)}
                icon={<InboxOutlined key="inbox" className="icon-margin-right" />}
                disabled={annotation.isLockedByOwner}
                title={
                  annotation.isLockedByOwner ? "Locked annotations cannot be archived." : undefined
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
                onClick={() => this.setLockedState(annotation, !annotation.isLockedByOwner)}
                icon={
                  annotation.isLockedByOwner ? (
                    <LockOutlined key="lock" className="icon-margin-right" />
                  ) : (
                    <UnlockOutlined key="unlock" className="icon-margin-right" />
                  )
                }
              >
                {annotation.isLockedByOwner ? "Unlock" : "Lock"}
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
            onClick={() => this.finishOrReopenAnnotation("reopen", annotation)}
            icon={<FolderOpenOutlined key="folder" className="icon-margin-right" />}
          >
            Reopen
          </AsyncLink>
          <br />
        </div>
      );
    }
  };

  getCurrentAnnotations(): Array<APIAnnotationInfo> {
    return this.getCurrentModeState().annotations;
  }

  handleSearchChanged = (event: React.ChangeEvent<HTMLInputElement>): void => {
    this.setState({
      searchQuery: event.target.value,
    });
  };

  renameAnnotation(annotation: APIAnnotationInfo, name: string) {
    editAnnotation(annotation.id, annotation.typ, { name })
      .then(() => {
        Toast.success(messages["annotation.was_edited"]);
        this.updateAnnotationInLocalState(annotation, (t) => update(t, { name: { $set: name } }));
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
            annotations: prevState.archivedModeState.annotations.concat(
              selectedAnnotations.map((annotation) =>
                this._updateAnnotationWithArchiveAction(annotation, "finish"),
              ),
            ),
          },
          unarchivedModeState: {
            ...prevState.unarchivedModeState,
            annotations: _.without(
              prevState.unarchivedModeState.annotations,
              ...selectedAnnotations,
            ),
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
      const newAnnotations = prevState.unarchivedModeState.annotations.map((t) => {
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
        unarchivedModeState: { ...prevState.unarchivedModeState, annotations: newAnnotations },
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

  _getSearchFilteredAnnotations() {
    // Note, this method should only be used to pass annotations
    // to the antd table. Antd itself can apply additional filters
    // (e.g., filtering by owner in the column header).
    // Use `this.currentPageData` if you need all currently visible
    // items of the active page.
    const filteredAnnotations = Utils.filterWithSearchQueryAND(
      this.getCurrentAnnotations(),
      ["id", "name", "modified", "tags", "owner"],
      this.state.searchQuery,
    );

    if (this.state.tags.length === 0) {
      // This check is not strictly necessary, but serves
      // as an early-out to save some computations.
      return filteredAnnotations;
    }

    return filteredAnnotations.filter((el) => _.intersection(this.state.tags, el.tags).length > 0);
  }

  renderIdAndCopyButton(annotation: APIAnnotationInfo) {
    const copyIdToClipboard = async () => {
      await navigator.clipboard.writeText(annotation.id);
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
        {formatHash(annotation.id)}
      </div>
    );
  }

  renderNameWithDescription(annotation: APIAnnotationInfo) {
    return (
      <div style={{ color: annotation.name ? "inherit" : "#7c7c7c" }}>
        <TextWithDescription
          isEditable={this.isAnnotationEditable(annotation)}
          value={annotation.name ? annotation.name : "Unnamed Annotation"}
          onChange={(newName) => this.renameAnnotation(annotation, newName)}
          label="Annotation Name"
          description={annotation.description}
        />
      </div>
    );
  }

  isAnnotationEditable(annotation: APIAnnotationInfo): boolean {
    return annotation.owner?.id === this.props.activeUser.id || annotation.othersMayEdit;
  }

  renderTable() {
    const filteredAndSortedAnnotations = this._getSearchFilteredAnnotations().sort(
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
          filteredAndSortedAnnotations.map((annotation) =>
            annotation.owner != null
              ? { formattedName: formatUserName(annotation.owner), id: annotation.owner.id }
              : null,
          ),
        ),
      ),
      "id",
    ).map(({ formattedName, id }) => ({ text: formattedName, value: id }));
    const teamFilters = _.uniqBy(
      _.flatMap(filteredAndSortedAnnotations, (annotation) => annotation.teams),
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

    if (filteredAndSortedAnnotations.length === 0) {
      return this.getEmptyListPlaceholder();
    }

    const disabledColor = { color: "var(--ant-color-text-disabled)" };
    const columns: ColumnType<APIAnnotationInfo>[] = [
      {
        title: "ID",
        dataIndex: "id",
        width: 100,
        render: (__: any, annotation: APIAnnotationInfo) => (
          <>
            <div className="monospace-id">{this.renderIdAndCopyButton(annotation)}</div>

            {!this.isAnnotationEditable(annotation) ? (
              <div style={disabledColor}>{READ_ONLY_ICON} read-only</div>
            ) : null}
            {annotation.isLockedByOwner ? (
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
        render: (_name: string, annotation: APIAnnotationInfo) =>
          this.renderNameWithDescription(annotation),
      },
      {
        title: "Owner & Teams",
        dataIndex: "owner",
        width: 300,
        filters: ownerAndTeamsFilters,
        filterMode: "tree",
        onFilter: (value: React.Key | boolean, annotation: APIAnnotationInfo) =>
          (annotation.owner != null && annotation.owner.id === value.toString()) ||
          annotation.teams.some((team) => team.id === value),
        sorter: Utils.localeCompareBy((annotation) => annotation.owner?.firstName || ""),
        render: (owner: APIUser | null, annotation: APIAnnotationInfo) => {
          const ownerName = owner != null ? renderOwner(owner) : null;
          const teamTags = annotation.teams.map((t) => (
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
            stats={_.mapValues(
              _.keyBy(annotation.annotationLayers, (layer) => layer.tracingId),
              (layer) => layer.stats,
            )}
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
                  !this.state.shouldShowArchivedAnnotations
                }
              />
            ))}
            {this.state.shouldShowArchivedAnnotations ? null : (
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
        render: (__: any, annotation: APIAnnotationInfo) => this.renderActions(annotation),
      },
    ];

    return (
      <Table
        dataSource={filteredAndSortedAnnotations}
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
          shouldShowArchivedAnnotations={this.state.shouldShowArchivedAnnotations}
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
          {!this.getCurrentModeState().loadedAllAnnotations ? (
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
  shouldShowArchivedAnnotations,
  archiveAll,
}: {
  isAdminView: boolean;
  handleOnSearch: SearchProps["onSearch"];
  handleSearchChanged: (event: React.ChangeEvent<HTMLInputElement>) => void;
  searchQuery: string;
  toggleShowArchived: () => void;
  shouldShowArchivedAnnotations: boolean;
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
        Show {shouldShowArchivedAnnotations ? "Open" : "Archived"} Annotations
      </Button>
      {!shouldShowArchivedAnnotations ? (
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
