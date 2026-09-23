import Icon, {
  DownloadOutlined,
  FolderOpenOutlined,
  InboxOutlined,
  LockOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SearchOutlined,
  TeamOutlined,
  UnlockOutlined,
  UserOutlined,
} from "@ant-design/icons";
import ReadOnlyIcon from "@images/icons/icon-read-only.svg?react";
import IconSort from "@images/icons/icon-sort.svg?react";
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
import { Button, Radio, Space, Table, Tag, Typography } from "antd";
import type { SearchProps } from "antd/es/input";
import type { ColumnType } from "antd/es/table/interface";
import { AsyncLink } from "components/async_clickables";
import FormattedDate from "components/formatted_date";
import FormattedId from "components/formatted_id";
import LinkButton from "components/link_button";
import TextWithDescription from "components/text_with_description";
import { FilterChip, ListFilterHeader, RowMetaLine } from "dashboard/list_filter_header";
import update from "immutability-helper";
import { stringToTagColor } from "libs/colors";
import { handleGenericError } from "libs/error_handling";
import Persistence from "libs/persistence";
import Toast from "libs/toast";
import {
  compareBy,
  filterWithSearchQueryAND,
  localeCompareBy,
  pluralize,
  scrollToTop,
} from "libs/utils";
import { type WithModalProps, withModal } from "libs/with_modal_hoc";
import compact from "lodash-es/compact";
import intersection from "lodash-es/intersection";
import keyBy from "lodash-es/keyBy";
import mapValues from "lodash-es/mapValues";
import partial from "lodash-es/partial";
import uniqBy from "lodash-es/uniqBy";
import without from "lodash-es/without";
import messages from "messages";
import type React from "react";
import { PureComponent } from "react";
import { Link } from "react-router";
import {
  type APIAnnotationInfo,
  type APITeam,
  type APIUser,
  type APIUserCompact,
  annotationToCompact,
} from "types/api_types";
import type { Comparator } from "types/type_utils";
import { AnnotationContentTypes } from "viewer/constants";
import { isAnnotationEditableByNonOwners } from "viewer/model/accessors/annotation_accessor";
import { getVolumeDescriptors } from "viewer/model/accessors/volumetracing_accessor";
import CategorizationLabel, {
  CategorizationSearch,
} from "viewer/view/components/categorization_label";
import EditableTextIcon from "viewer/view/components/editable_text_icon";
import { AnnotationStats } from "viewer/view/right_border_tabs/info_tab/annotation_stats_section";
import { DashboardEmptyAnnotationsPlaceholder } from "./dashboard_empty_annotations_placeholder";
import { DashboardTopBar } from "./dashboard_top_bar";

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
  datasetNameFilter?: string | null;
  // Called when the user removes the datasetNameFilter tag, so the caller can clear it from the URL.
  onDatasetNameFilterCleared?: () => void;
} & WithModalProps;
type AnnotationSortOption = "modifiedDesc" | "newest" | "oldest" | "owner" | "name";
const ANNOTATION_SORT_OPTIONS: Array<{ key: AnnotationSortOption; label: string }> = [
  { key: "modifiedDesc", label: "Last Modified" },
  { key: "newest", label: "Newest" },
  { key: "oldest", label: "Oldest" },
  { key: "owner", label: "Owner" },
  { key: "name", label: "Name" },
];

// Sorts ascending by the selector's string value, except entries with an empty
// (trimmed) selector value always sort last, regardless of alphabetical order.
function compareWithEmptyLast<T>(selector: (item: T) => string): Comparator<T> {
  const naturalCompare = localeCompareBy<T>(selector);
  return (a: T, b: T) => {
    const aIsEmpty = selector(a).trim() === "";
    const bIsEmpty = selector(b).trim() === "";
    if (aIsEmpty && bIsEmpty) return 0;
    if (aIsEmpty) return 1;
    if (bIsEmpty) return -1;
    return naturalCompare(a, b);
  };
}
type State = {
  shouldShowArchivedAnnotations: boolean;
  archivedModeState: AnnotationModeState;
  unarchivedModeState: AnnotationModeState;
  searchQuery: string;
  tags: Array<string>;
  isLoading: boolean;
  selectedOwnerId: string | null;
  selectedTeamId: string | null;
  sortOption: AnnotationSortOption;
};
type PartialState = Pick<State, "searchQuery" | "shouldShowArchivedAnnotations">;
const persistence = new Persistence<PartialState>(
  {
    searchQuery: PropTypes.string,
    shouldShowArchivedAnnotations: PropTypes.bool,
  },
  "explorativeList",
);

function formatUserName(user: APIUserCompact) {
  return `${user.firstName} ${user.lastName}`;
}

class ExplorativeAnnotationsView extends PureComponent<Props, State> {
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
    selectedOwnerId: null,
    selectedTeamId: null,
    sortOption: "modifiedDesc",
  };

  // This attribute is not part of the state, since it is only set in the
  // summary-prop of <Table /> which is called by antd on render.
  // Other than that, the value should not be changed. It can be used to
  // retrieve the items of the currently rendered page (while respecting
  // the active search and filters).
  currentPageData: Readonly<APIAnnotationInfo[]> = [];

  componentDidMount() {
    const partialState: Partial<State> = {
      ...(persistence.load() as PartialState),
    };
    if (this.props.datasetNameFilter) {
      partialState.tags = [this.props.datasetNameFilter];
    }
    this.setState(partialState as State, () => {
      this.fetchNextPage(0);
    });
  }

  componentDidUpdate(prevProps: Props, prevState: State) {
    persistence.persist(this.state);

    if (this.state.shouldShowArchivedAnnotations !== prevState.shouldShowArchivedAnnotations) {
      this.fetchNextPage(0);
    }

    if (this.props.datasetNameFilter !== prevProps.datasetNameFilter) {
      // Dataset filter changed via the URL.
      this.setState((state) => ({
        tags: this.props.datasetNameFilter
          ? [this.props.datasetNameFilter]
          : state.tags.filter((tag) => tag !== prevProps.datasetNameFilter),
      }));
    } else if (
      prevProps.datasetNameFilter != null &&
      prevState.tags.includes(prevProps.datasetNameFilter) &&
      !this.state.tags.includes(prevProps.datasetNameFilter)
    ) {
      this.props.onDatasetNameFilterCleared?.();
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
          annotations: uniqBy(
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

    this.props.modal.confirm({
      title: "Archive Annotations",
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
            annotations: without(prevState.unarchivedModeState.annotations, ...selectedAnnotations),
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
            const newTags = without(t.tags, tag);

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
    const filteredAnnotations = filterWithSearchQueryAND(
      this.getCurrentAnnotations(),
      ["id", "name", "modified", "tags", "owner"],
      this.state.searchQuery,
    );

    if (this.state.tags.length === 0) {
      // This check is not strictly necessary, but serves
      // as an early-out to save some computations.
      return filteredAnnotations;
    }

    return filteredAnnotations.filter((el) => intersection(this.state.tags, el.tags).length > 0);
  }

  renderNameWithDescription(annotation: APIAnnotationInfo) {
    const isEditable = this.isAnnotationEditable(annotation);
    const linkTarget = `/annotations/${annotation.id}`;
    const textWithDescription = (
      <TextWithDescription
        isEditable={isEditable}
        value={annotation.name ? annotation.name : "Unnamed Annotation"}
        onChange={(newName) => this.renameAnnotation(annotation, newName)}
        label="Annotation Name"
        description={annotation.description}
        width={400}
        // Makes the name itself a link to the annotation (only the edit icon
        // triggers renaming then); see EditableTextLabel's linkTarget prop.
        linkTarget={linkTarget}
        linkTitle="Open"
      />
    );
    return (
      <span
        className="dashboard-annotation-name-edit"
        style={{
          marginInlineEnd: 8,
        }}
      >
        {isEditable ? (
          textWithDescription
        ) : (
          <Link to={linkTarget} className="incognito-link" title="Open">
            {textWithDescription}
          </Link>
        )}
      </span>
    );
  }

  isAnnotationEditable(annotation: APIAnnotationInfo): boolean {
    return (
      annotation.owner?.id === this.props.activeUser.id ||
      isAnnotationEditableByNonOwners(annotation)
    );
  }

  renderOwner = (owner: APIUserCompact) => {
    if (!this.props.isAdminView && owner.id === this.props.activeUser.id) {
      return (
        <span>
          {formatUserName(owner)}{" "}
          <span style={{ color: "var(--ant-color-text-secondary)" }}>(you)</span>
        </span>
      );
    }
    return formatUserName(owner);
  };

  renderAnnotationRow = (annotation: APIAnnotationInfo) => {
    const owner = annotation.owner;
    const teamTags = annotation.teams.map((team) => (
      <Tag key={team.id} color={stringToTagColor(team.name)} variant="outlined">
        {team.name}
      </Tag>
    ));

    return (
      <div>
        {this.renderNameWithDescription(annotation)}
        {!this.isAnnotationEditable(annotation) ? (
          <LinkButton
            disabled
            style={{ marginInlineEnd: 8 }}
            icon={<Icon component={ReadOnlyIcon} />}
          >
            read-only
          </LinkButton>
        ) : null}
        {annotation.isLockedByOwner ? (
          <LinkButton disabled style={{ marginInlineEnd: 8 }} icon={<LockOutlined />}>
            locked
          </LinkButton>
        ) : null}
        <Space wrap size={4}>
          {annotation.tags.map((tag) => (
            <CategorizationLabel
              key={tag}
              kind="annotations"
              onClick={partial(this.addTagToSearch, tag)}
              onClose={partial(this.editTagFromAnnotation, annotation, false, tag)}
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
              onChange={partial(this.editTagFromAnnotation, annotation, true)}
            />
          )}
        </Space>
        <RowMetaLine
          items={[
            <FormattedId key="id" id={annotation.id} />,
            owner ? (
              <span key="owner" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <UserOutlined /> {this.renderOwner(owner)}
              </span>
            ) : null,
            teamTags.length > 0 ? (
              <span key="teams" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <TeamOutlined /> {teamTags}
              </span>
            ) : null,
            <AnnotationStats
              key="stats"
              stats={mapValues(
                keyBy(annotation.annotationLayers, (layer) => layer.tracingId),
                (layer) => layer.stats,
              )}
              asInfoBlock={false}
              withMargin={false}
              orientation="horizontal"
            />,
            <span key="modified">
              modified <FormattedDate timestamp={annotation.modified} />
            </span>,
          ]}
        />
      </div>
    );
  };

  renderEmptyText(): React.ReactNode {
    if (this.state.isLoading) {
      // Avoid flashing the "no results" placeholder (or the call-to-action card)
      // while the initial page of annotations is still being fetched - the
      // table's own loading spinner (see the `loading` prop below) covers this.
      return null;
    }
    const { searchQuery, tags, selectedOwnerId, selectedTeamId, shouldShowArchivedAnnotations } =
      this.state;
    const isSearchOrFilterActive =
      searchQuery !== "" ||
      tags.length > 0 ||
      selectedOwnerId != null ||
      selectedTeamId != null ||
      shouldShowArchivedAnnotations;

    if (!isSearchOrFilterActive) {
      return <DashboardEmptyAnnotationsPlaceholder />;
    }

    const activeFilterLabels: string[] = [];
    if (selectedOwnerId != null) activeFilterLabels.push("owner");
    if (selectedTeamId != null) activeFilterLabels.push("teams");
    if (shouldShowArchivedAnnotations) activeFilterLabels.push("status");

    return (
      <>
        <p>No annotations match your search.</p>
        {activeFilterLabels.length > 0 ? (
          <p>Note that annotations are currently filtered by {activeFilterLabels.join(", ")}.</p>
        ) : null}
        <Button type="link" onClick={this.clearSearchAndFilters}>
          Clear search and filters
        </Button>
      </>
    );
  }

  clearSearchAndFilters = () => {
    this.setState({
      searchQuery: "",
      tags: [],
      selectedOwnerId: null,
      selectedTeamId: null,
      shouldShowArchivedAnnotations: false,
    });
  };

  renderTable() {
    const searchFilteredAnnotations = this._getSearchFilteredAnnotations();
    const { selectedOwnerId, selectedTeamId, sortOption } = this.state;

    const ownerFilters = uniqBy(
      // Prepend the active user's own entry to the front so that it's listed first.
      ([this.props.activeUser] as APIUserCompact[]).concat(
        compact(searchFilteredAnnotations.map((annotation) => annotation.owner)),
      ),
      "id",
    );
    const teamFilters = uniqBy(
      searchFilteredAnnotations.flatMap((annotation) => annotation.teams),
      "id",
    );

    const hasOwnerOrTeamFilter = selectedOwnerId != null || selectedTeamId != null;
    const ownerTeamFilteredAnnotations = hasOwnerOrTeamFilter
      ? searchFilteredAnnotations.filter(
          (annotation) =>
            (selectedOwnerId != null && annotation.owner?.id === selectedOwnerId) ||
            (selectedTeamId != null && annotation.teams.some((team) => team.id === selectedTeamId)),
        )
      : searchFilteredAnnotations;

    const getSortComparator = (): Comparator<APIAnnotationInfo> => {
      switch (sortOption) {
        case "name":
          return compareWithEmptyLast<APIAnnotationInfo>((annotation) => annotation.name);
        case "owner":
          return compareWithEmptyLast<APIAnnotationInfo>((annotation) =>
            annotation.owner ? formatUserName(annotation.owner) : "",
          );
        case "oldest":
          return compareBy<APIAnnotationInfo>((annotation) => annotation.modified, true);
        default:
          // "modifiedDesc" and "newest" both sort by last-modified, descending -
          // there's no separate "created" timestamp for annotations to distinguish them.
          return compareBy<APIAnnotationInfo>((annotation) => annotation.modified, false);
      }
    };
    const sortComparator = getSortComparator();
    const filteredAndSortedAnnotations = [...ownerTeamFilteredAnnotations].sort(sortComparator);
    // Annotations are loaded page-wise and filtered afterwards, so unloaded pages may
    // contain more matches than are shown.
    const { lastLoadedPage, loadedAllAnnotations } = this.getCurrentModeState();
    const mayHaveMoreAnnotations = lastLoadedPage >= 0 && !loadedAllAnnotations;

    const columns: ColumnType<APIAnnotationInfo>[] = [
      {
        dataIndex: "name",
        key: "name",
        className: "dashboard-list-table-borderless-cell",
        render: (_name: string, annotation: APIAnnotationInfo) =>
          this.renderAnnotationRow(annotation),
      },
      {
        width: 200,
        className: "nowrap",
        key: "action",
        render: (__: any, annotation: APIAnnotationInfo) => this.renderActions(annotation),
      },
    ];

    const currentSortLabel =
      ANNOTATION_SORT_OPTIONS.find((option) => option.key === sortOption)?.label ?? "Last Modified";

    return (
      <>
        <ListFilterHeader
          summary={`${filteredAndSortedAnnotations.length}${mayHaveMoreAnnotations ? "+" : ""} ${pluralize("Annotation", filteredAndSortedAnnotations.length)}`}
        >
          <FilterChip label="Owner" active={selectedOwnerId != null}>
            <Space orientation="vertical" size={4}>
              <Radio
                checked={selectedOwnerId == null}
                onChange={() => this.setState({ selectedOwnerId: null })}
              >
                All
              </Radio>
              {ownerFilters.map((owner) => (
                <Radio
                  key={owner.id}
                  checked={selectedOwnerId === owner.id}
                  onChange={() => this.setState({ selectedOwnerId: owner.id })}
                >
                  {this.renderOwner(owner)}
                </Radio>
              ))}
            </Space>
          </FilterChip>
          <FilterChip label="Teams" active={selectedTeamId != null}>
            <Space orientation="vertical" size={4}>
              <Radio
                checked={selectedTeamId == null}
                onChange={() => this.setState({ selectedTeamId: null })}
              >
                All
              </Radio>
              {teamFilters.map((team: APITeam) => (
                <Radio
                  key={team.id}
                  checked={selectedTeamId === team.id}
                  onChange={() => this.setState({ selectedTeamId: team.id })}
                >
                  {team.name}
                </Radio>
              ))}
            </Space>
          </FilterChip>
          <FilterChip label="Status" active={this.state.shouldShowArchivedAnnotations}>
            <Space orientation="vertical" size={4}>
              <Radio
                checked={!this.state.shouldShowArchivedAnnotations}
                onChange={() => {
                  if (this.state.shouldShowArchivedAnnotations) this.toggleShowArchived();
                }}
              >
                Open
              </Radio>
              <Radio
                checked={this.state.shouldShowArchivedAnnotations}
                onChange={() => {
                  if (!this.state.shouldShowArchivedAnnotations) this.toggleShowArchived();
                }}
              >
                Archived
              </Radio>
            </Space>
          </FilterChip>
          <FilterChip
            label={
              <>
                <Icon component={IconSort} /> Sort: {currentSortLabel}
              </>
            }
          >
            <Space orientation="vertical" size={4}>
              {ANNOTATION_SORT_OPTIONS.map((option) => (
                <Radio
                  key={option.key}
                  checked={sortOption === option.key}
                  onChange={() => this.setState({ sortOption: option.key })}
                >
                  {option.label}
                </Radio>
              ))}
            </Space>
          </FilterChip>
        </ListFilterHeader>
        <Table
          dataSource={filteredAndSortedAnnotations}
          rowKey="id"
          showHeader={false}
          bordered
          loading={this.state.isLoading}
          pagination={{
            defaultPageSize: 50,
            onChange: scrollToTop,
          }}
          locale={{
            emptyText: this.renderEmptyText(),
          }}
          className="large-table dashboard-list-table"
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
      </>
    );
  }

  render() {
    return (
      <div>
        <DashboardTopBar
          isAdminView={this.props.isAdminView}
          handleOnSearch={this.handleOnSearch}
          handleSearchChanged={this.handleSearchChanged}
          searchQuery={this.state.searchQuery}
          shouldShowArchivedAnnotations={this.state.shouldShowArchivedAnnotations}
          archiveAll={this.archiveAll}
        />
        {this.state.searchQuery ? (
          <Typography.Title level={3}>
            <Space>
              <SearchOutlined />
              <span>Search Results for &quot;{this.state.searchQuery}&quot;</span>
            </Space>
          </Typography.Title>
        ) : null}
        <CategorizationSearch
          itemName="annotations"
          searchTags={this.state.tags}
          setTags={(tags) =>
            this.setState({
              tags,
            })
          }
          localStorageSavingKey="lastDashboardSearchTags"
          skipRestoreFromStorage={this.props.datasetNameFilter != null}
        />
        {this.renderTable()}
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

export default withModal(ExplorativeAnnotationsView);
