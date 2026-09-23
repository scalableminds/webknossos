import Icon, {
  FileOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import fileDarkIcon from "@images/file-dark.png";
import fileLightIcon from "@images/file-light.png";
import folderThumbnailIcon from "@images/folder-thumbnail.svg";
import IconSort from "@images/icons/icon-sort.svg?react";
import inactiveDatasetThumbnail from "@images/inactive-dataset-thumbnail.svg";
import type { DatasetUpdater } from "admin/rest_api";
import { App, Button, Dropdown, type MenuProps, Radio, Space, Table, Tag, Tooltip } from "antd";
import type { ColumnType } from "antd/es/table/interface";
import classNames from "classnames";
import FastTooltip from "components/fast_tooltip";
import FormattedDate from "components/formatted_date";
import DatasetActionView, {
  getDatasetActionContextMenu,
} from "dashboard/advanced_dataset/dataset_action_view";
import { DraggableDatasetType } from "dashboard/advanced_dataset/dnd_types";
import type { DatasetCollectionContextValue } from "dashboard/dataset/dataset_collection_context";
import { MINIMUM_SEARCH_QUERY_LENGTH, SEARCH_RESULTS_LIMIT } from "dashboard/dataset/queries";
import type { DatasetFilteringMode } from "dashboard/dataset_view";
import {
  type DnDDropItemProps,
  generateSettingsForFolder,
  useDatasetDrop,
} from "dashboard/folders/folder_tree";
import { FilterChip, ListFilterHeader, RowMetaLine } from "dashboard/list_filter_header";
import { diceCoefficient as dice } from "dice-coefficient";
import { stringToTagColor } from "libs/colors";
import { formatCountToDataAmountUnit } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import Shortcut from "libs/shortcut_component";
import { localeCompareBy, pluralize, scrollContainerToTop } from "libs/utils";
import difference from "lodash-es/difference";
import keyBy from "lodash-es/keyBy";
import minBy from "lodash-es/minBy";
import noop from "lodash-es/noop";
import partial from "lodash-es/partial";
import sortBy from "lodash-es/sortBy";
import without from "lodash-es/without";
import type React from "react";
import { Fragment, PureComponent, useCallback, useContext } from "react";
import { DndProvider, DragPreviewImage, useDrag } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { Link } from "react-router";
import type { APIDatasetCompact, APIMaybeUnimportedDataset, FolderItem } from "types/api_types";
import type { EmptyObject } from "types/type_utils";
import { Unicode } from "viewer/constants";
import { getViewDatasetURL } from "viewer/model/accessors/dataset_accessor";
import CategorizationLabel from "viewer/view/components/categorization_label";
import EditableTextIcon from "viewer/view/components/editable_text_icon";
import { ContextMenuContext } from "viewer/view/context_menu/context_menu";
import { GenericContextMenuContainer } from "viewer/view/context_menu/generic_context_menu_container";
import { getContextMenuPositionFromEvent } from "viewer/view/context_menu/helpers";

type FolderItemWithName = FolderItem & { name: string };
type DatasetOrFolder = APIDatasetCompact | FolderItemWithName;
type RowRenderer = DatasetRenderer | FolderRenderer;
type DatasetSortOption =
  | "lastUsed"
  | "createdDesc"
  | "createdAsc"
  | "name"
  | "storage"
  | "annotationCount";

const { ThinSpace } = Unicode;

const DATASET_SORT_OPTIONS: Array<{ key: DatasetSortOption; label: string }> = [
  { key: "lastUsed", label: "Last used" },
  { key: "createdDesc", label: "Newest" },
  { key: "createdAsc", label: "Oldest" },
  { key: "name", label: "Name" },
  { key: "storage", label: "Used Storage" },
  { key: "annotationCount", label: "Most Annotations" },
];

const THUMBNAIL_SIZE = 80;

type Props = {
  datasets: Array<APIDatasetCompact>;
  subfolders: FolderItem[];
  searchQuery: string;
  searchTags: Array<string>;
  isUserAdminOrDatasetManager: boolean;
  datasetFilteringMode: DatasetFilteringMode;
  setDatasetFilteringMode: (mode: DatasetFilteringMode) => void;
  updateDataset: (datasetId: string, updater: DatasetUpdater) => void;
  addTagToSearch: (tag: string) => void;
  onClearSearchAndFilters: () => void;
  onSelectDataset: (dataset: APIDatasetCompact | null, multiSelect?: boolean) => void;
  onSelectFolder: (folder: FolderItem | null) => void;
  selectedDatasets: APIDatasetCompact[];
  context: DatasetCollectionContextValue;
  // The table is rendered inside a scrolling container that isn't the window
  // (see dataset_folder_view.tsx). Passed through so pagination changes can
  // scroll that container back to the top instead of the (non-scrolling) window.
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
  // Shows a loading spinner inside the table body (e.g. while waiting for search
  // results), without hiding the header bar above it.
  isLoading?: boolean;
  // Custom content shown as the table's empty state instead of the regular hint text
  // (e.g. the welcome cards for a brand-new, completely empty organization).
  emptyStateContent?: React.ReactNode;
};

type State = {
  prevSearchQuery: string;
  sortOption: DatasetSortOption;
  // Tracks whether the user explicitly picked a sort option (via the Sort filter chip).
  // While false and a search query is active, results are sorted by search relevance instead.
  hasUserSetSort: boolean;
  contextMenuPosition: [number, number] | null | undefined;
  datasetsForContextMenu: APIDatasetCompact[];
  folderForContextMenu: FolderItemWithName | null;
};

type ContextMenuProps = {
  datasetCollectionContext: DatasetCollectionContextValue;
  contextMenuPosition: [number, number] | null | undefined;
  hideContextMenu: () => void;
  datasets: APIDatasetCompact[];
  folder: FolderItemWithName | null;
};

function ContextMenuInner(propsWithInputRef: ContextMenuProps) {
  const inputRef = useContext(ContextMenuContext);
  const { modal } = App.useApp();
  const { datasets, contextMenuPosition, hideContextMenu, folder, datasetCollectionContext } =
    propsWithInputRef;
  const { clearCacheAndReloadDataset } = datasetCollectionContext;
  let menu: MenuProps = { items: [] };

  if (contextMenuPosition != null) {
    if (datasets.length > 0) {
      // getDatasetActionContextMenu should not be turned into <DatasetActionMenu />
      // as this breaks antd's styling of the menu within the dropdown.
      menu = getDatasetActionContextMenu({
        hideContextMenu,
        datasets,
        clearCacheAndReloadDataset,
        modal,
      });
    } else if (folder != null) {
      menu = generateSettingsForFolder(folder, datasetCollectionContext, true);
    }
  }

  if (inputRef == null || inputRef.current == null) return null;
  const refContent = inputRef.current;

  return (
    <Fragment>
      <Shortcut supportInputElements keys="escape" onTrigger={hideContextMenu} />
      <Dropdown
        menu={menu}
        classNames={{ root: "dropdown-overlay-container-for-context-menu" }}
        open={contextMenuPosition != null}
        getPopupContainer={() => refContent}
        destroyOnHidden
      >
        <div />
      </Dropdown>
    </Fragment>
  );
}

function ContextMenuContainer(props: ContextMenuProps) {
  return (
    /* Sticky positioning doesn't work for this container for some reason.
     * The y position is always off by a certain amount.
     * Maybe because the container doesn't cover the entire screen?
     * Use absolute positioning for now. This forgoes the "stay-in-container"
     * behavior, but that's not critical for the context menu right now.
     */
    <GenericContextMenuContainer positionAbsolute {...props}>
      <ContextMenuInner {...props} />
    </GenericContextMenuContainer>
  );
}

// Adapted from https://ant.design/components/table/
// (needed adaption to react-dnd 11.1.3). Updating react-dnd
// wasn't possible due to react-sortable-tree.
interface DraggableDatasetRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  index: number;
  isADataset: boolean;
  rowKey: string;
}

function isRecordADataset(record: DatasetOrFolder): record is APIDatasetCompact {
  return (record as APIDatasetCompact).folderId !== undefined;
}

function sortDatasetsByOption(
  datasets: APIDatasetCompact[],
  sortOption: DatasetSortOption,
): APIDatasetCompact[] {
  switch (sortOption) {
    case "createdAsc":
      return sortBy(datasets, "created");
    case "createdDesc":
      return sortBy(datasets, "created").reverse();
    case "name":
      return [...datasets].sort(localeCompareBy((dataset) => dataset.name));
    case "storage":
      return sortBy(datasets, (dataset) => dataset.usedStorageBytes || 0).reverse();
    case "annotationCount":
      return sortBy(datasets, (dataset) => dataset.annotationCount || 0).reverse();
    default:
      // "lastUsed": rank datasets by recency of use, falling back to creation date.
      return sortBy(datasets, ["lastUsedByUser", "created"]).reverse();
  }
}

class DragPreviewProvider {
  static singleton: DragPreviewProvider | null;
  lightIcon: string | null;
  darkIcon: string | null;

  constructor() {
    // We fine-tune the drag image of a row because some browsers don't make
    // the row transparent enough. Since the table row is quite wide, it often
    // hides important UI elements (such as the directory sidebar).
    // Unfortunately, the icons have to be converted to a DataURL to work with
    // DragPreviewImage from react-dnd. This conversion is handled by this class
    // here.

    // The icons are loaded asynchronously as soon as DragPreviewProvider
    // is instantiated. As long as the files were not loaded, an empty
    // string will be used for the preview which the browser will simply ignore
    // and do its default drag behavior (i.e., showing a drag preview of the entire
    // row).
    this.lightIcon = null;
    this.darkIcon = null;
    this.convertImageURLtoDataURL(fileLightIcon).then((dataURL) => {
      this.lightIcon = dataURL;
    });
    this.convertImageURLtoDataURL(fileDarkIcon).then((dataURL) => {
      this.darkIcon = dataURL;
    });
  }

  convertImageURLtoDataURL(src: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "Anonymous";
      image.onload = () => {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (!context) {
          return reject("Could not construct context");
        }
        canvas.height = image.naturalHeight;
        canvas.width = image.naturalWidth;
        context.drawImage(image, 0, 0);
        const dataURL = canvas.toDataURL("image/png");
        resolve(dataURL);
      };
      image.src = src;
    });
  }

  getIcon(theme: "dark" | "light") {
    if (theme === "dark") {
      return this.darkIcon || "";
    } else {
      return this.lightIcon || "";
    }
  }

  static getProvider() {
    if (!DragPreviewProvider.singleton) {
      DragPreviewProvider.singleton = new DragPreviewProvider();
    }
    return DragPreviewProvider.singleton;
  }
}

const DraggableDatasetRow = ({
  index,
  className,
  style,
  children,
  isADataset,
  rowKey,
  ...restProps
}: DraggableDatasetRowProps) => {
  const theme = useWkSelector((state) => state.uiInformation.theme);

  // @ts-expect-error
  const datasetId = restProps["data-row-key"];
  const dragItem: DnDDropItemProps = { index, datasetId };
  const [, drag, preview] = useDrag({
    item: dragItem,
    type: DraggableDatasetType,
    canDrag: () => isADataset,
  });
  const [collectedProps, drop] = useDatasetDrop(rowKey, !isADataset);
  const combinedRef = useCallback(
    (node: HTMLTableRowElement | null) => {
      if (node) {
        drag(node);
        drop(node);
      }
    },
    [drag, drop],
  );
  const { canDrop, isOver } = collectedProps;
  const fileIcon = DragPreviewProvider.getProvider().getIcon(theme);
  const styleWithMaybeMoveCursor = isADataset
    ? { ...style, cursor: "move" }
    : { ...style, cursor: "not-allowed !important" };
  return (
    <tr
      ref={combinedRef}
      className={classNames(className, { "highlight-folder-sidebar": canDrop && isOver })}
      style={styleWithMaybeMoveCursor}
      {...restProps}
    >
      <DragPreviewImage connect={preview} src={fileIcon} />
      {children}
    </tr>
  );
};

const components = {
  body: {
    row: DraggableDatasetRow,
  },
};

class DatasetRenderer {
  data: APIDatasetCompact;
  datasetTable: DatasetTable;
  constructor(data: APIDatasetCompact, datasetTable: DatasetTable) {
    this.data = data;
    this.datasetTable = datasetTable;
  }
  static getRowKey(dataset: APIDatasetCompact) {
    return dataset.id;
  }
  getRowKey() {
    return DatasetRenderer.getRowKey(this.data);
  }

  renderStorageColumn(): React.ReactNode {
    if (this.data.usedStorageBytes == null) return null;
    const formattedBytes = formatCountToDataAmountUnit(this.data.usedStorageBytes, true);
    return this.data.usedStorageBytes > 0 ? (
      <FastTooltip title={`${new Intl.NumberFormat().format(this.data.usedStorageBytes)} bytes`}>
        {formattedBytes}
      </FastTooltip>
    ) : (
      <FastTooltip
        html={`
          The storage may be zero because:
          <ul>
            <li>The storage hasn't been scanned yet</li>
            <li>The data is streamed from external sources</li>
            <li>The data layers are already counted in other (linked) datasets</li>
            <li>The dataset belongs to another organization</li>
            <li>The dataset is empty</li>
          </ul>
        `}
      >
        {formattedBytes}
      </FastTooltip>
    );
  }
  renderTypeColumn(): React.ReactNode {
    return <FileOutlined style={{ fontSize: "18px" }} />;
  }
  renderThumbnailColumn(): React.ReactNode {
    const selectedLayerName: string | null = this.data.isActive
      ? this.data.colorLayerNames[0] || this.data.segmentationLayerNames[0]
      : null;
    const imgSrc = selectedLayerName
      ? `/api/datasets/${this.data.id}/layers/${selectedLayerName}/thumbnail?w=${2 * THUMBNAIL_SIZE}&h=${2 * THUMBNAIL_SIZE}`
      : inactiveDatasetThumbnail;
    const iconClassName = selectedLayerName ? "" : " icon-thumbnail";

    return (
      <Link to={getViewDatasetURL(this.data)} title="View Dataset">
        <img
          src={imgSrc}
          className={`dataset-table-thumbnail ${iconClassName}`}
          style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE }}
          alt=""
        />
      </Link>
    );
  }
  renderNameColumn(): React.ReactNode {
    return (
      <div className="dataset-table-name-container">
        <Link
          to={getViewDatasetURL(this.data)}
          title="View Dataset"
          className="incognito-link dataset-table-name"
        >
          {this.data.name}
        </Link>
        {this.renderTags()}
        {this.renderMetaLine()}
        {this.datasetTable.props.context.globalSearchQuery != null ? (
          <BreadcrumbsTag parts={this.datasetTable.props.context.getBreadcrumbs(this.data)} />
        ) : null}
      </div>
    );
  }
  renderTags(): React.ReactNode {
    return this.data.isActive ? (
      <DatasetTags
        dataset={this.data}
        onClickTag={this.datasetTable.props.addTagToSearch}
        updateDataset={this.datasetTable.props.updateDataset}
      />
    ) : (
      <FastTooltip title="No tags available for inactive datasets">
        <WarningOutlined
          style={{
            color: "@disabled-color",
          }}
        />
      </FastTooltip>
    );
  }
  renderMetaLine(): React.ReactNode {
    const { annotationCount } = this.data;
    return (
      <RowMetaLine
        items={[
          this.renderStorageColumn(),
          annotationCount ? (
            <Link
              key="annotations"
              to={`/dashboard/annotations?dataset=${encodeURIComponent(this.data.name)}`}
            >
              {annotationCount} {pluralize("Annotation", annotationCount)}
            </Link>
          ) : null,
          <span key="created">created {this.renderCreationDateColumn()}</span>,
        ]}
      />
    );
  }
  renderCreationDateColumn(): React.ReactNode {
    return <FormattedDate timestamp={this.data.created} />;
  }
  renderActionsColumn(): React.ReactNode {
    return <DatasetActionView dataset={this.data} />;
  }
}

class FolderRenderer {
  data: FolderItemWithName;
  datasetTable: DatasetTable;

  constructor(data: FolderItemWithName, datasetTable: DatasetTable) {
    this.data = data;
    this.datasetTable = datasetTable;
  }
  static getRowKey(folder: FolderItemWithName) {
    return folder.key;
  }
  getRowKey() {
    return FolderRenderer.getRowKey(this.data);
  }
  renderThumbnailColumn(): React.ReactNode {
    return (
      <img
        src={folderThumbnailIcon}
        className="dataset-table-thumbnail icon-thumbnail"
        style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE }}
        alt=""
      />
    );
  }
  renderNameColumn(): React.ReactNode {
    return (
      <div className="dataset-table-name-container">
        <span className="incognito-link dataset-table-name">{this.data.name}</span>
        <RowMetaLine
          items={["Folder", <span key="created">created {this.renderCreationDateColumn()}</span>]}
        />
      </div>
    );
  }
  renderStorageColumn(): React.ReactNode {
    return null;
  }
  renderCreationDateColumn(): React.ReactNode {
    return <FormattedDate timestamp={this.data.created} />;
  }
  renderActionsColumn(): React.ReactNode {
    return this.datasetTable.getFolderSettingsActions(this.data);
  }
}

class DatasetTable extends PureComponent<Props, State> {
  state: State = {
    sortOption: "lastUsed",
    hasUserSetSort: false,
    prevSearchQuery: "",
    contextMenuPosition: null,
    datasetsForContextMenu: [],
    folderForContextMenu: null,
  };
  // currentPageData is only used for range selection (and not during
  // rendering). That's why it's not included in this.state (also it
  // would lead to infinite loops, too).
  currentPageData: RowRenderer[] = [];

  static getDerivedStateFromProps(nextProps: Props, prevState: State): Partial<State> {
    const maybeResetSort: { hasUserSetSort: boolean } | EmptyObject = // Fall back to relevance-sorting exactly when the search box is initially filled
      // (searchQuery changes from empty string to non-empty string), unless the user
      // explicitly picks a sort option afterwards.
      nextProps.searchQuery !== "" && prevState.prevSearchQuery === ""
        ? { hasUserSetSort: false }
        : {};
    return {
      prevSearchQuery: nextProps.searchQuery,
      ...maybeResetSort,
    };
  }

  getFilteredDatasets() {
    const filterByMode = (datasets: APIDatasetCompact[]) => {
      const { datasetFilteringMode } = this.props;

      if (datasetFilteringMode === "onlyShowReported") {
        return datasets.filter((el) => !el.isUnreported);
      } else if (datasetFilteringMode === "onlyShowUnreported") {
        return datasets.filter((el) => el.isUnreported);
      } else {
        return datasets;
      }
    };

    const filteredByTags = (datasets: APIDatasetCompact[]) =>
      datasets.filter((dataset) => {
        const notIncludedTags = difference(this.props.searchTags, dataset.tags);

        return notIncludedTags.length === 0;
      });

    const filterByHasLayers = (datasets: APIDatasetCompact[]) =>
      this.props.isUserAdminOrDatasetManager
        ? datasets
        : datasets.filter((dataset) => dataset.isActive);

    return filteredByTags(filterByMode(filterByHasLayers(this.props.datasets)));
  }

  renderEmptyText(): React.ReactNode {
    if (this.props.emptyStateContent != null) {
      return this.props.emptyStateContent;
    }
    const { searchQuery, searchTags, datasetFilteringMode } = this.props;
    const isSearchOrFilterActive =
      searchQuery.length > 0 ||
      searchTags.length > 0 ||
      datasetFilteringMode !== "onlyShowReported";
    const maybeClearButton = isSearchOrFilterActive ? (
      <Button type="link" onClick={this.props.onClearSearchAndFilters}>
        Clear search and filters
      </Button>
    ) : null;

    const maybeWarning =
      datasetFilteringMode === "onlyShowUnreported" ? (
        <p>Note that datasets are currently filtered by status.</p>
      ) : null;
    if (searchQuery.length > 0) {
      return searchQuery.length >= MINIMUM_SEARCH_QUERY_LENGTH ? (
        <>
          <p>No datasets match your search.</p>
          {maybeWarning}
          {maybeClearButton}
        </>
      ) : (
        <>
          <p>Enter at least {MINIMUM_SEARCH_QUERY_LENGTH} characters to search</p>
          {maybeClearButton}
        </>
      );
    }
    if (!("queries" in this.props.context)) {
      return <p>No Datasets found.</p>;
    }
    const emptyListHintText = this.props.isUserAdminOrDatasetManager
      ? "There are no datasets in this folder. Import one or move a dataset from another folder."
      : "There are no datasets in this folder. Please ask an admin or dataset manager to import a dataset or to grant you permissions to add datasets to this folder.";
    return (
      <>
        <p>{emptyListHintText}</p>
        {maybeWarning}
        {maybeClearButton}
      </>
    );
  }

  showContextMenuAt = (xPos: number, yPos: number) => {
    // On Windows the right click to open the context menu is also triggered for the overlay
    // of the context menu. This causes the context menu to instantly close after opening.
    // Therefore delay the state update to delay that the context menu is rendered.
    // Thus the context overlay does not get the right click as an event and therefore does not close.
    setTimeout(
      () =>
        this.setState({
          contextMenuPosition: [xPos, yPos],
        }),
      0,
    );
  };

  getFolderSettingsActions(folder: FolderItemWithName): React.ReactNode {
    const { context } = this.props;
    const folderTreeContextMenuItems = generateSettingsForFolder(folder, context, true);
    const settings = folderTreeContextMenuItems.items
      .filter((item) => !item.disabled)
      .map((item) => {
        return (
          <Link onClick={item.onClick} key={item.key} to="">
            {item.icon}
            {item.label}
          </Link>
        );
      });
    return settings.length > 0 ? (
      <div className="dataset-table-actions nowrap">{...settings}</div>
    ) : null;
  }

  render() {
    const { folderForContextMenu, datasetsForContextMenu, contextMenuPosition } = this.state;
    const { context, selectedDatasets, onSelectFolder, subfolders } = this.props;
    const activeSubfolders: FolderItemWithName[] = subfolders.map((folder) => ({
      ...folder,
      name: folder.title,
    }));
    const filteredDataSource = this.getFilteredDatasets();
    // Search results are capped by the backend and filtered afterwards, so reaching the cap
    // means more matches may exist than are shown.
    const mayHaveMoreSearchResults =
      this.props.context.globalSearchQuery != null &&
      this.props.context.datasets.length >= SEARCH_RESULTS_LIMIT;
    const { sortOption, hasUserSetSort } = this.state;
    let dataSourceSortedByOption: Array<DatasetOrFolder> = sortDatasetsByOption(
      filteredDataSource,
      sortOption,
    );
    const isSearchQueryLongEnough = this.props.searchQuery.length >= MINIMUM_SEARCH_QUERY_LENGTH;
    if (!isSearchQueryLongEnough) {
      dataSourceSortedByOption = dataSourceSortedByOption.concat(activeSubfolders);
    }
    // Create a map from dataset to its rank
    const datasetToRankMap: Map<DatasetOrFolder, number> = new Map(
      dataSourceSortedByOption.map((dataset, rank) => [dataset, rank]),
    );
    const sortedDataSource =
      // Sort using the dice coefficient if the user hasn't picked an explicit sort option
      // and if the query is at least 3 characters long to avoid sorting *all* datasets
      isSearchQueryLongEnough && !hasUserSetSort
        ? sortBy(
            [...filteredDataSource, ...activeSubfolders].map((datasetOrFolder) => {
              const diceCoefficient = dice(datasetOrFolder.name, this.props.searchQuery);
              const rank = datasetToRankMap.get(datasetOrFolder) || 0;
              const rankCoefficient = 1 - rank / filteredDataSource.length;
              const coefficient = (diceCoefficient + rankCoefficient) / 2;
              return {
                datasetOrFolder,
                coefficient,
              };
            }),
            "coefficient",
          )
            .map(({ datasetOrFolder }) => datasetOrFolder)
            .reverse()
        : dataSourceSortedByOption;
    const sortedDataSourceRenderers: RowRenderer[] = sortedDataSource.map((record) =>
      isRecordADataset(record)
        ? new DatasetRenderer(record, this)
        : new FolderRenderer(record, this),
    );

    let selectedRowKeys: string[] = [];
    if (selectedDatasets.length > 0) {
      selectedRowKeys = selectedDatasets.map(DatasetRenderer.getRowKey);
    } else if (context.selectedFolder && "name" in context.selectedFolder) {
      selectedRowKeys = [FolderRenderer.getRowKey(context.selectedFolder as FolderItemWithName)];
    }

    const columns: ColumnType<RowRenderer>[] = [
      {
        // Explicit width so this column doesn't grow beyond the thumbnail's own size
        // when the other columns don't have enough content to fill the table's width.
        width: THUMBNAIL_SIZE + 16, // 16 = the cell's remaining (left-side only) padding
        key: "thumbnail",
        className: "dashboard-list-table-borderless-cell dashboard-list-table-thumbnail-cell",
        render: (__, rowRenderer: RowRenderer) => rowRenderer.renderThumbnailColumn(),
      },
      {
        dataIndex: "name",
        key: "name",
        className: "dashboard-list-table-borderless-cell",
        render: (_name: string, rowRenderer: RowRenderer, _index) => rowRenderer.renderNameColumn(),
      },
      {
        width: 200,
        key: "actions",
        render: (__, rowRenderer: RowRenderer) => rowRenderer.renderActionsColumn(),
      },
    ];

    const canSortByStorage =
      this.props.isUserAdminOrDatasetManager &&
      context.usedStorageInOrga != null &&
      context.usedStorageInOrga > 0;
    const availableSortOptions = DATASET_SORT_OPTIONS.filter(
      (option) => option.key !== "storage" || canSortByStorage,
    );
    const currentSortLabel =
      availableSortOptions.find((option) => option.key === sortOption)?.label ?? "Last used";

    return (
      <DndProvider backend={HTML5Backend}>
        <ContextMenuContainer
          hideContextMenu={() => {
            this.setState({ contextMenuPosition: null });
          }}
          datasets={datasetsForContextMenu}
          folder={folderForContextMenu}
          contextMenuPosition={contextMenuPosition}
          datasetCollectionContext={context}
        />
        <ListFilterHeader
          summary={
            <>
              {filteredDataSource.length}
              {mayHaveMoreSearchResults ? "+" : ""}{" "}
              {pluralize("Dataset", filteredDataSource.length)}
              {activeSubfolders.length > 0
                ? `, ${activeSubfolders.length} ${pluralize("Subfolder", activeSubfolders.length)}`
                : null}
            </>
          }
        >
          {this.props.isUserAdminOrDatasetManager ? (
            <FilterChip
              label="Status"
              // "onlyShowReported" is the default filtering mode (see dataset_view.tsx), so
              // only highlight this chip once the user has actually deviated from it - matching
              // how the Owner/Teams/Status chips on the Annotations tab start out unhighlighted.
              active={this.props.datasetFilteringMode !== "onlyShowReported"}
            >
              <Space orientation="vertical" size={4}>
                <Radio
                  checked={this.props.datasetFilteringMode === "onlyShowReported"}
                  onChange={() => this.props.setDatasetFilteringMode("onlyShowReported")}
                >
                  Only show available datasets
                </Radio>
                <Radio
                  checked={this.props.datasetFilteringMode === "onlyShowUnreported"}
                  onChange={() => this.props.setDatasetFilteringMode("onlyShowUnreported")}
                >
                  Only show missing datasets
                </Radio>
                <Radio
                  checked={this.props.datasetFilteringMode === "showAllDatasets"}
                  onChange={() => this.props.setDatasetFilteringMode("showAllDatasets")}
                >
                  Show all datasets
                </Radio>
              </Space>
            </FilterChip>
          ) : null}
          <FilterChip
            label={
              <>
                <Icon component={IconSort} /> Sort: {currentSortLabel}
              </>
            }
          >
            <Space orientation="vertical" size={4}>
              {availableSortOptions.map((option) => (
                <Radio
                  key={option.key}
                  checked={sortOption === option.key}
                  onChange={() => this.setState({ sortOption: option.key, hasUserSetSort: true })}
                >
                  {option.label}
                </Radio>
              ))}
            </Space>
          </FilterChip>
        </ListFilterHeader>
        <Table
          dataSource={sortedDataSourceRenderers}
          columns={columns}
          rowKey={(renderer: RowRenderer) => renderer.getRowKey()}
          components={components}
          showHeader={false}
          bordered
          loading={this.props.isLoading}
          className="dashboard-list-table"
          rowClassName={(renderer: RowRenderer) =>
            selectedRowKeys.includes(renderer.getRowKey()) ? "ant-table-row-selected" : ""
          }
          pagination={{
            defaultPageSize: 50,
            onChange: () => scrollContainerToTop(this.props.scrollContainerRef?.current),
          }}
          locale={{
            emptyText: this.renderEmptyText(),
          }}
          summary={(currentPageData) => {
            // Workaround to get to the currently rendered entries (since the ordering
            // is managed by antd).
            // Also see https://github.com/ant-design/ant-design/issues/24022.
            this.currentPageData = currentPageData as RowRenderer[];
            return null;
          }}
          onRow={(record: RowRenderer) => {
            const { data } = record;
            const isADataset = isRecordADataset(data);
            return {
              rowKey: record.getRowKey(),
              isADataset: isADataset,
              onDragStart: () => {
                if (isADataset && !selectedDatasets.includes(data)) {
                  this.props.onSelectDataset(data);
                }
              },
              onClick: (event) => {
                // @ts-expect-error
                if (event.target?.tagName !== "TD" && event.target?.tagName !== "DIV") {
                  // Don't (de)select when another element within the row was clicked
                  // (e.g., a link). Otherwise, clicking such elements would cause two actions
                  // (e.g., the link action and a (de)selection).
                  return;
                }
                if (!isADataset) {
                  onSelectFolder(data);
                  return;
                }
                if (!event.shiftKey || selectedDatasets.length === 0) {
                  this.props.onSelectDataset(data, event.ctrlKey || event.metaKey);
                } else {
                  // Shift was pressed and there's already another selected dataset that was not
                  // clicked just now.
                  // We are using the current page data as there is no way to get the currently
                  // rendered datasets otherwise. Also see
                  // https://github.com/ant-design/ant-design/issues/24022.
                  const renderedRowData = this.currentPageData.map((row) => row.data);

                  const clickedDatasetIdx = renderedRowData.indexOf(data);
                  const selectedIndices = selectedDatasets.map((selectedDS) =>
                    renderedRowData.indexOf(selectedDS),
                  );
                  const closestSelectedDatasetIdx = minBy(selectedIndices, (idx) =>
                    Math.abs(idx - clickedDatasetIdx),
                  );

                  if (clickedDatasetIdx == null || closestSelectedDatasetIdx == null) {
                    return;
                  }

                  const [start, end] = [closestSelectedDatasetIdx, clickedDatasetIdx].sort(
                    (a, b) => a - b,
                  );

                  for (let idx = start; idx <= end; idx++) {
                    // closestSelectedDatasetIdx is already selected (don't deselect it).
                    const currentRow = renderedRowData[idx];
                    if (idx !== closestSelectedDatasetIdx && isRecordADataset(currentRow)) {
                      this.props.onSelectDataset(currentRow, true);
                    }
                  }
                }
              },
              onContextMenu: (event) => {
                event.preventDefault();

                // Find the overlay div whose parent acts as a reference for positioning the context menu.
                // Since the dashboard tabs don't destroy their contents after switching the tabs,
                // there might be several overlays. We will use the one with a non-zero width since
                // this should be the relevant one.
                const [x, y] = getContextMenuPositionFromEvent(event, "node-context-menu-overlay");

                this.showContextMenuAt(x, y);
                if (isADataset) {
                  if (selectedDatasets.includes(data)) {
                    this.setState({
                      datasetsForContextMenu: selectedDatasets,
                      folderForContextMenu: null,
                    });
                  } else {
                    // If dataset is clicked which is not selected, ignore the selected
                    // datasets.
                    this.setState({
                      datasetsForContextMenu: [data],
                      folderForContextMenu: null,
                    });
                  }
                } else {
                  this.setState({
                    folderForContextMenu: data,
                    datasetsForContextMenu: [],
                  });
                }
              },
              onDoubleClick: () => {
                if (isADataset) {
                  window.location.href = getViewDatasetURL(data);
                } else {
                  context.setActiveFolderId(data.key);
                }
              },
            };
          }}
        />
      </DndProvider>
    );
  }
}

export function DatasetTags({
  dataset,
  onClickTag,
  updateDataset,
}: {
  dataset: APIDatasetCompact;
  onClickTag?: (t: string) => void;
  updateDataset: (datasetId: string, updater: DatasetUpdater) => void;
}) {
  const editTagFromDataset = (
    shouldAddTag: boolean,
    tag: string,
    event: React.SyntheticEvent,
  ): void => {
    event.stopPropagation(); // prevent the onClick event

    if (!dataset.isActive) {
      console.error(
        `Tags can only be modified for active datasets. ${dataset.name} is not active.`,
      );
      return;
    }
    let updater = {};
    if (shouldAddTag) {
      if (!dataset.tags.includes(tag)) {
        updater = {
          tags: [...dataset.tags, tag],
        };
      }
    } else {
      const newTags = without(dataset.tags, tag);
      updater = {
        tags: newTags,
      };
    }

    updateDataset(dataset.id, updater);
  };

  return (
    <Space>
      {dataset.tags.map((tag) => (
        <CategorizationLabel
          tag={tag}
          key={tag}
          kind="datasets"
          onClick={partial(onClickTag || noop, tag)}
          onClose={partial(editTagFromDataset, false, tag)}
          closable={dataset.isEditable}
        />
      ))}
      {dataset.isEditable ? (
        <EditableTextIcon
          icon={<PlusOutlined />}
          onChange={partial(editTagFromDataset, true)}
          label="Add Tag"
        />
      ) : null}
    </Space>
  );
}

export function DatasetLayerTags({ dataset }: { dataset: APIMaybeUnimportedDataset }) {
  return (
    <Space wrap>
      {(dataset.isActive ? dataset.dataSource.dataLayers : []).map((layer) => (
        <Tag
          key={layer.name}
          style={{
            maxWidth: 250,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
          variant="outlined"
        >
          {layer.name} - {layer.elementClass}
        </Tag>
      ))}
    </Space>
  );
}

export function TeamTags({
  dataset,
  emptyValue,
}: {
  dataset: APIMaybeUnimportedDataset;
  emptyValue?: React.ReactNode;
}) {
  const teams = dataset.allowedTeamsCumulative;
  const permittedTeams = [...teams];
  if (dataset.isPublic) {
    permittedTeams.push({ name: "public", id: "", organization: "", isOrganizationTeam: false });
  }

  if (permittedTeams.length === 0 && emptyValue != null) {
    return <Tag variant="outlined">{emptyValue}</Tag>;
  }

  const allowedTeamsById = keyBy(dataset.allowedTeams, "id");
  return (
    <Space>
      {permittedTeams.map((team) => {
        const isCumulative = !allowedTeamsById[team.id];
        return (
          <Tooltip
            title={
              isCumulative
                ? "This team may access this dataset, because of the permissions of the current folder."
                : null
            }
            key={`allowed_teams_${dataset.name}_${team.name}`}
          >
            <Tag
              style={{
                maxWidth: 200,
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
              }}
              variant="outlined"
              color={stringToTagColor(team.name)}
            >
              {team.name}
              {isCumulative ? "*" : ""}
            </Tag>
          </Tooltip>
        );
      })}
    </Space>
  );
}

function formatPath(parts: string[]) {
  return parts.join(`${ThinSpace}/${ThinSpace}`);
}

function BreadcrumbsTag({ parts: allParts }: { parts: string[] | null }) {
  if (allParts == null) {
    return null;
  }
  let parts;
  if (allParts.length <= 4) {
    parts = allParts;
  } else {
    parts = [...allParts.slice(0, 2), "...", ...allParts.slice(-2)];
  }

  return (
    <Tooltip title={`This dataset is located in ${formatPath(allParts)}.`}>
      <Tag style={{ marginTop: "5px" }} variant="outlined">
        <FolderOpenOutlined className="icon-margin-right" />
        {formatPath(parts)}
      </Tag>
    </Tooltip>
  );
}

export default DatasetTable;
