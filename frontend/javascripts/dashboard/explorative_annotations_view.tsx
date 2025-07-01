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

function ExplorativeAnnotationsView(props: Props) {
  const [shouldShowArchivedAnnotations, setShouldShowArchivedAnnotations] = React.useState(false);
  const [archivedModeState, setArchivedModeState] = React.useState<AnnotationModeState>({
    annotations: [],
    lastLoadedPage: -1,
    loadedAllAnnotations: false,
  });
  const [unarchivedModeState, setUnarchivedModeState] = React.useState<AnnotationModeState>({
    annotations: [],
    lastLoadedPage: -1,
    loadedAllAnnotations: false,
  });
  const [searchQuery, setSearchQuery] = React.useState("");
  const [tags, setTags] = React.useState<Array<string>>([]);
  const [isLoading, setIsLoading] = React.useState(false);

  const currentPageData = React.useRef<Readonly<APIAnnotationInfo[]>>([]);

  React.useEffect(() => {
    const persistedState = persistence.load() as PartialState;
    if (persistedState) {
      setSearchQuery(persistedState.searchQuery);
      setShouldShowArchivedAnnotations(persistedState.shouldShowArchivedAnnotations);
    }
    fetchNextPage(0);
  }, []);

  React.useEffect(() => {
    persistence.persist({ searchQuery, shouldShowArchivedAnnotations });
  }, [searchQuery, shouldShowArchivedAnnotations]);

  React.useEffect(() => {
    if (getModeState(shouldShowArchivedAnnotations).lastLoadedPage === -1) {
      fetchNextPage(0);
    }
  }, [shouldShowArchivedAnnotations]);

  const getCurrentModeState = () => getModeState(shouldShowArchivedAnnotations);

  const getModeState = (useArchivedAnnotations: boolean) => {
    if (useArchivedAnnotations) {
      return archivedModeState;
    } else {
      return unarchivedModeState;
    }
  };

  const updateAnnotationInLocalState = (
    annotation: APIAnnotationInfo,
    callback: (arg0: APIAnnotationInfo) => APIAnnotationInfo,
  ) => {
    const annotations = getCurrentAnnotations();
    const newAnnotations = annotations.map((currentAnnotation) =>
      currentAnnotation.id !== annotation.id ? currentAnnotation : callback(currentAnnotation),
    );
    setModeState({ annotations: newAnnotations }, shouldShowArchivedAnnotations);
  };

  const setModeState = (modeShape: Partial<AnnotationModeState>, useArchivedAnnotations: boolean) =>
    addToShownAnnotations(modeShape, useArchivedAnnotations);

  const addToShownAnnotations = (
    modeShape: Partial<AnnotationModeState>,
    useArchivedAnnotations: boolean,
  ) => {
    const mode = useArchivedAnnotations ? "archivedModeState" : "unarchivedModeState";
    if (useArchivedAnnotations) {
      setArchivedModeState((prevState) => ({
        ...prevState,
        ...modeShape,
      }));
    } else {
      setUnarchivedModeState((prevState) => ({
        ...prevState,
        ...modeShape,
      }));
    }
  };

  const fetchNextPage = async (pageNumber: number) => {
    // this does not refer to the pagination of antd but to the pagination of querying data from SQL
    const showArchivedAnnotations = shouldShowArchivedAnnotations;
    const currentModeState = getCurrentModeState();
    const previousAnnotations = currentModeState.annotations;

    if (currentModeState.loadedAllAnnotations || pageNumber <= currentModeState.lastLoadedPage) {
      return;
    }

    try {
      setIsLoading(true);

      const annotations =
        props.userId != null
          ? // If an administrator views the dashboard of a specific user, we only fetch the annotations of that user.
            await getCompactAnnotationsForUser(
              props.userId,
              showArchivedAnnotations,
              pageNumber,
            )
          : await getReadableAnnotations(showArchivedAnnotations, pageNumber);

      setModeState(
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
      setIsLoading(false);
    }
  };

  const toggleShowArchived = () => {
    setShouldShowArchivedAnnotations((prev) => !prev);
  };

  const finishOrReopenAnnotation = async (type: "finish" | "reopen", annotation: APIAnnotationInfo) => {
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
    const newAnnotations = getModeState(!shouldFinish).annotations.filter(
      (t) => t.id !== annotation.id,
    );
    setModeState(
      {
        annotations: newAnnotations,
      },
      !shouldFinish,
    );

    // If the annotation was finished, add it to the finished list
    // (and vice versa).
    const existingAnnotations = getModeState(shouldFinish).annotations;
    setModeState(
      {
        annotations: [newAnnotation].concat(existingAnnotations),
      },
      shouldFinish,
    );
  };

  const _updateAnnotationWithArchiveAction = (
    annotation: APIAnnotationInfo,
    type: "finish" | "reopen",
  ): APIAnnotationInfo => ({
    ...annotation,
    state: type === "reopen" ? "Active" : "Finished",
  });

  const setLockedState = async (annotation: APIAnnotationInfo, locked: boolean) => {
    try {
      const newAnnotation = await editLockedState(annotation.id, annotation.typ, locked);
      Toast.success(messages["annotation.was_edited"]);
      updateAnnotationInLocalState(annotation, (_t) => newAnnotation);
    } catch (error) {
      handleGenericError(error as Error, "Could not update the annotation lock state.");
    }
  };

  const renderActions = (annotation: APIAnnotationInfo) => {
    if (annotation.typ !== "Explorational") {
      return null;
    }
    const isActiveUserOwner = annotation.owner?.id === props.activeUser.id;

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
          {isAnnotationEditable(annotation) ? (
            <>
              <br />
              <AsyncLink
                href="#"
                onClick={() => finishOrReopenAnnotation("finish", annotation)}
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
                onClick={() => setLockedState(annotation, !annotation.isLockedByOwner)}
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
            onClick={() => finishOrReopenAnnotation("reopen", annotation)}
            icon={<FolderOpenOutlined key="folder" className="icon-margin-right" />}
          >
            Reopen
          </AsyncLink>
          <br />
        </div>
      );
    }
  };

  const getCurrentAnnotations = (): Array<APIAnnotationInfo> => {
    return getCurrentModeState().annotations;
  };

  const handleSearchChanged = (event: React.ChangeEvent<HTMLInputElement>): void => {
    setSearchQuery(event.target.value);
  };

  const renameAnnotation = (annotation: APIAnnotationInfo, name: string) => {
    editAnnotation(annotation.id, annotation.typ, { name })
      .then(() => {
        Toast.success(messages["annotation.was_edited"]);
        updateAnnotationInLocalState(annotation, (t) => update(t, { name: { $set: name } }));
      })
      .catch((error) => {
        handleGenericError(error as Error, "Could not update the annotation name.");
      });
  };

  const archiveAll = () => {
    const selectedAnnotations = currentPageData.current.filter(
      (annotation: APIAnnotationInfo) => annotation.owner?.id === props.activeUser.id,
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
        setArchivedModeState((prevState) => ({
          ...prevState,
          annotations: prevState.annotations.concat(
            selectedAnnotations.map((annotation) =>
              _updateAnnotationWithArchiveAction(annotation, "finish"),
            ),
          ),
        }));
        setUnarchivedModeState((prevState) => ({
          ...prevState,
          annotations: _.without(
            prevState.annotations,
            ...selectedAnnotations,
          ),
        }));
      },
    });
  };

  const addTagToSearch = (tag: string): void => {
    if (!tags.includes(tag)) {
      setTags((prevTags) => [...prevTags, tag]);
    }
  };

  const editTagFromAnnotation = (
    annotation: APIAnnotationInfo,
    shouldAddTag: boolean,
    tag: string,
    event?: React.SyntheticEvent,
  ): void => {
    event?.stopPropagation(); // prevent the onClick event

    setUnarchivedModeState((prevState) => {
      const newAnnotations = prevState.annotations.map((t) => {
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
        ...prevState, annotations: newAnnotations
      };
    });
  };

  const getEmptyListPlaceholder = () => {
    return isLoading ? null : (
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

  const handleOnSearch: SearchProps["onSearch"] = (value, _event) => {
    if (value !== "") {
      addTagToSearch(value);
      setSearchQuery("");
    }
  };

  const _getSearchFilteredAnnotations = () => {
    // Note, this method should only be used to pass annotations
    // to the antd table. Antd itself can apply additional filters
    // (e.g., filtering by owner in the column header).
    // Use `this.currentPageData` if you need all currently visible
    // items of the active page.
    const filteredAnnotations = Utils.filterWithSearchQueryAND(
      getCurrentAnnotations(),
      ["id", "name", "modified", "tags", "owner"],
      searchQuery,
    );

    if (tags.length === 0) {
      // This check is not strictly necessary, but serves
      // as an early-out to save some computations.
      return filteredAnnotations;
    }

    return filteredAnnotations.filter((el) => _.intersection(tags, el.tags).length > 0);
  };

  const renderIdAndCopyButton = (annotation: APIAnnotationInfo) => {
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
  };

  const renderNameWithDescription = (annotation: APIAnnotationInfo) => {
    return (
      <div style={{ color: annotation.name ? "inherit" : "#7c7c7c" }}>
        <TextWithDescription
          isEditable={isAnnotationEditable(annotation)}
          value={annotation.name ? annotation.name : "Unnamed Annotation"}
          onChange={(newName) => renameAnnotation(annotation, newName)}
          label="Annotation Name"
          description={annotation.description}
        />
      </div>
    );
  };

  const isAnnotationEditable = (annotation: APIAnnotationInfo): boolean => {
    return annotation.owner?.id === props.activeUser.id || annotation.othersMayEdit;
  };

  const renderTable = () => {
    const filteredAndSortedAnnotations = _getSearchFilteredAnnotations().sort(
      Utils.compareBy<APIAnnotationInfo>((annotation) => annotation.modified, false),
    );
    const renderOwner = (owner: APIUser) => {
      if (!props.isAdminView && owner.id === props.activeUser.id) {
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
        { formattedName: formatUserName(props.activeUser), id: props.activeUser.id },
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
      return getEmptyListPlaceholder();
    }

    const disabledColor = { color: "var(--ant-color-text-disabled)" };
    const columns: ColumnType<APIAnnotationInfo>[] = [
      {
        title: "ID",
        dataIndex: "id",
        width: 100,
        render: (__: any, annotation: APIAnnotationInfo) => (
          <>
            <div className="monospace-id">{renderIdAndCopyButton(annotation)}</div>

            {!isAnnotationEditable(annotation) ? (
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
          renderNameWithDescription(annotation),
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
                onClick={_.partial(addTagToSearch, tag)}
                onClose={_.partial(editTagFromAnnotation, annotation, false, tag)}
                tag={tag}
                closable={
                  !(tag === annotation.dataSetName || AnnotationContentTypes.includes(tag)) &&
                  !shouldShowArchivedAnnotations
                }
              />
            ))}
            {shouldShowArchivedAnnotations ? null : (
              <EditableTextIcon
                icon={<PlusOutlined />}
                onChange={_.partial(editTagFromAnnotation, annotation, true)}
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
        render: (__: any, annotation: APIAnnotationInfo) => renderActions(annotation),
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
          currentPageData.current = currentPageData;
          return null;
        }}
        columns={columns}
      />
    );
  };

  const renderSearchTags = () => {
    return (
      <CategorizationSearch
        itemName="annotations"
        searchTags={tags}
        setTags={setTags}
        localStorageSavingKey="lastDashboardSearchTags"
      />
    );
  };

  return (
    <div>
      <TopBar
        isAdminView={props.isAdminView}
        handleOnSearch={handleOnSearch}
        handleSearchChanged={handleSearchChanged}
        searchQuery={searchQuery}
        toggleShowArchived={toggleShowArchived}
        shouldShowArchivedAnnotations={shouldShowArchivedAnnotations}
        archiveAll={archiveAll}
      />
      {renderSearchTags()}
      <Spin spinning={isLoading} size="large" style={{ marginTop: 4 }}>
        {renderTable()}
      </Spin>
      <div
        style={{
          textAlign: "right",
        }}
      >
        {!getCurrentModeState().loadedAllAnnotations ? (
          <Link
            to="#"
            onClick={() => fetchNextPage(getCurrentModeState().lastLoadedPage + 1)}
          >
            Load more Annotations
          </Link>
        ) : null}
      </div>
    </div>
  );
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


