import {
  DownloadOutlined,
  FolderOpenOutlined,
  PlayCircleOutlined,
  SearchOutlined,
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
import { Space, Typography } from "antd";
import type { SearchProps } from "antd/es/input";
import { AsyncLink } from "components/async_clickables";
import update from "immutability-helper";
import { handleGenericError } from "libs/error_handling";
import Persistence from "libs/persistence";
import Toast from "libs/toast";
import { type WithModalProps, withModal } from "libs/with_modal_hoc";
import uniqBy from "lodash-es/uniqBy";
import without from "lodash-es/without";
import messages from "messages";
import type React from "react";
import { PureComponent } from "react";
import { Link } from "react-router";
import { type APIAnnotationInfo, type APIUser, annotationToCompact } from "types/api_types";
import { getVolumeDescriptors } from "viewer/model/accessors/volumetracing_accessor";
import { CategorizationSearch } from "viewer/view/components/categorization_label";
import { AnnotationDetailsSidebar } from "./annotation_details_sidebar";
import {
  AnnotationList,
  isAnnotationEditable,
  mayArchiveAnnotation,
  mayLockAnnotation,
} from "./annotation_list";
import { AnnotationTags } from "./annotation_tags";
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
type State = {
  shouldShowArchivedAnnotations: boolean;
  archivedModeState: AnnotationModeState;
  unarchivedModeState: AnnotationModeState;
  searchQuery: string;
  tags: Array<string>;
  isLoading: boolean;
  selectedAnnotationId: string | null;
};
type PartialState = Pick<State, "searchQuery" | "shouldShowArchivedAnnotations">;
const persistence = new Persistence<PartialState>(
  {
    searchQuery: PropTypes.string,
    shouldShowArchivedAnnotations: PropTypes.bool,
  },
  "explorativeList",
);

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
    selectedAnnotationId: null,
  };

  // This attribute is not part of the state, since it is only set while <AnnotationList />
  // renders. Other than that, the value should not be changed. It can be used to
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

  setShowArchived = (shouldShowArchivedAnnotations: boolean) => {
    this.setState({ shouldShowArchivedAnnotations }, () => {
      if (this.getCurrentModeState().lastLoadedPage === -1) this.fetchNextPage(0);
    });
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
    const { typ, id, state } = annotation;

    if (state === "Active") {
      return (
        <div className="annotation-row-actions">
          <Link to={`/annotations/${id}`}>
            <PlayCircleOutlined className="icon-margin-right" />
            Open
          </Link>
          <AsyncLink
            onClick={() => {
              const hasVolumeAnnotation = getVolumeDescriptors(annotation).length > 0;
              return downloadAnnotation(id, typ, hasVolumeAnnotation);
            }}
            icon={<DownloadOutlined key="download" className="icon-margin-right" />}
          >
            Download
          </AsyncLink>
        </div>
      );
    } else {
      return (
        <div className="annotation-row-actions">
          <AsyncLink
            onClick={() => this.finishOrReopenAnnotation("reopen", annotation)}
            icon={<FolderOpenOutlined key="folder" className="icon-margin-right" />}
          >
            Reopen
          </AsyncLink>
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

  isAnnotationEditable(annotation: APIAnnotationInfo): boolean {
    return isAnnotationEditable(annotation, this.props.activeUser);
  }

  renderTags = (annotation: APIAnnotationInfo, isEditable: boolean, className?: string) => (
    <AnnotationTags
      annotation={annotation}
      isEditable={isEditable && !this.state.shouldShowArchivedAnnotations}
      onClickTag={this.addTagToSearch}
      onAddTag={(tag) => this.editTagFromAnnotation(annotation, true, tag)}
      onRemoveTag={(tag, event) => this.editTagFromAnnotation(annotation, false, tag, event)}
      className={className}
    />
  );

  clearSearchAndFilters = () => {
    this.setState({
      searchQuery: "",
      tags: [],
      shouldShowArchivedAnnotations: false,
    });
  };

  render() {
    const selectedAnnotation =
      this.getCurrentModeState().annotations.find(
        (annotation) => annotation.id === this.state.selectedAnnotationId,
      ) ?? null;
    return (
      <div className="dashboard-list-with-sidebar">
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
          <AnnotationList
            annotations={this.getCurrentAnnotations()}
            activeUser={this.props.activeUser}
            isAdminView={this.props.isAdminView}
            isLoading={this.state.isLoading}
            hasMoreAnnotations={
              this.getCurrentModeState().lastLoadedPage >= 0 &&
              !this.getCurrentModeState().loadedAllAnnotations
            }
            searchQuery={this.state.searchQuery}
            tags={this.state.tags}
            onTagsChange={(tags) => this.setState({ tags })}
            showArchived={this.state.shouldShowArchivedAnnotations}
            onShowArchivedChange={this.setShowArchived}
            selectedAnnotationId={this.state.selectedAnnotationId}
            onSelectAnnotation={(selectedAnnotationId) => this.setState({ selectedAnnotationId })}
            renderActions={this.renderActions}
            emptyPlaceholder={<DashboardEmptyAnnotationsPlaceholder />}
            onClearFilters={this.clearSearchAndFilters}
            onCurrentPageDataChange={(currentPageData) => {
              this.currentPageData = currentPageData;
            }}
          />
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
        <AnnotationDetailsSidebar
          annotation={selectedAnnotation}
          activeUser={this.props.activeUser}
          isReadOnly={selectedAnnotation != null && !this.isAnnotationEditable(selectedAnnotation)}
          tags={
            selectedAnnotation != null &&
            (selectedAnnotation.tags.length > 0 || !this.state.shouldShowArchivedAnnotations)
              ? this.renderTags(selectedAnnotation, true)
              : null
          }
          onRename={
            selectedAnnotation != null && this.isAnnotationEditable(selectedAnnotation)
              ? (newName) => this.renameAnnotation(selectedAnnotation, newName)
              : undefined
          }
          onArchive={
            selectedAnnotation != null &&
            mayArchiveAnnotation(selectedAnnotation, this.props.activeUser)
              ? () => this.finishOrReopenAnnotation("finish", selectedAnnotation)
              : undefined
          }
          onToggleLock={
            selectedAnnotation != null &&
            mayLockAnnotation(selectedAnnotation, this.props.activeUser)
              ? () => this.setLockedState(selectedAnnotation, !selectedAnnotation.isLockedByOwner)
              : undefined
          }
        />
      </div>
    );
  }
}

export default withModal(ExplorativeAnnotationsView);
