import {
  FileOutlined,
  FolderOpenOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import type { DatasetUpdater } from "admin/rest_api";
import { Dropdown, type MenuProps, Tag, Tooltip } from "antd";
import { Space } from "antd/lib";
import type {
  ColumnType,
  FilterValue,
  SorterResult,
  TablePaginationConfig,
} from "antd/lib/table/interface";
import classNames from "classnames";
import FastTooltip from "components/fast_tooltip";
import FixedExpandableTable from "components/fixed_expandable_table";
import FormattedDate from "components/formatted_date";
import DatasetActionView, {
  getDatasetActionContextMenu,
} from "dashboard/advanced_dataset/dataset_action_view";
import type { DatasetCollectionContextValue } from "dashboard/dataset/dataset_collection_context";
import { MINIMUM_SEARCH_QUERY_LENGTH } from "dashboard/dataset/queries";
import type { DatasetFilteringMode } from "dashboard/dataset_view";
import {
  type DnDDropItemProps,
  generateSettingsForFolder,
  useDatasetDrop,
} from "dashboard/folders/folder_tree";
import { diceCoefficient as dice } from "dice-coefficient";
import { formatCountToDataAmountUnit, stringToColor } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import Shortcut from "libs/shortcut_component";
import * as Utils from "libs/utils";
import _ from "lodash";
import * as React from "react";
import { DndProvider, DragPreviewImage, useDrag } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { Link } from "react-router-dom";
import type { APIDatasetCompact, APIMaybeUnimportedDataset, FolderItem } from "types/api_types";
import type { EmptyObject } from "types/globals";
import { Unicode } from "viewer/constants";
import { getReadableURLPart } from "viewer/model/accessors/dataset_accessor";
import CategorizationLabel from "viewer/view/components/categorization_label";
import EditableTextIcon from "viewer/view/components/editable_text_icon";
import {
  ContextMenuContext,
  GenericContextMenuContainer,
  getContextMenuPositionFromEvent,
} from "viewer/view/context_menu";

type FolderItemWithName = FolderItem & { name: string };
export type DatasetOrFolder = APIDatasetCompact | FolderItemWithName;
type RowRenderer = DatasetRenderer | FolderRenderer;

const { ThinSpace } = Unicode;
const useLruRank = true;

const THUMBNAIL_SIZE = 100;

type Props = {
  datasets: Array<APIDatasetCompact>;
  subfolders: FolderItem[];
  searchQuery: string;
  searchTags: Array<string>;
  isUserAdmin: boolean;
  isUserDatasetManager: boolean;
  datasetFilteringMode: DatasetFilteringMode;
  reloadDataset: (datasetId: string) => Promise<void>;
  updateDataset: (datasetId: string, updater: DatasetUpdater) => void;
  addTagToSearch: (tag: string) => void;
  onSelectDataset: (dataset: APIDatasetCompact | null, multiSelect?: boolean) => void;
  onSelectFolder: (folder: FolderItem | null) => void;
  setFolderIdForEditModal: (arg0: string | null) => void;
  selectedDatasets: APIDatasetCompact[];
  context: DatasetCollectionContextValue;
};

type State = {
  prevSearchQuery: string;
  sortedInfo: SorterResult<string>;
  contextMenuPosition: [number, number] | null | undefined;
  datasetsForContextMenu: APIDatasetCompact[];
  folderForContextMenu: FolderItemWithName | null;
};

type ContextMenuProps = {
  datasetCollectionContext: DatasetCollectionContextValue;
  contextMenuPosition: [number, number] | null | undefined;
  hideContextMenu: () => void;
  editFolder: () => void;
  datasets: APIDatasetCompact[];
  folder: FolderItemWithName | null;
  reloadDataset: Props["reloadDataset"];
};

function ContextMenuInner(propsWithInputRef: ContextMenuProps) {
  const inputRef = React.useContext(ContextMenuContext);
  const {
    datasets,
    reloadDataset,
    contextMenuPosition,
    hideContextMenu,
    folder,
    editFolder,
    datasetCollectionContext,
  } = propsWithInputRef;
  let menu: MenuProps = { items: [] };

  if (contextMenuPosition != null) {
    if (datasets.length > 0) {
      // getDatasetActionContextMenu should not be turned into <DatasetActionMenu />
      // as this breaks antd's styling of the menu within the dropdown.
      menu = getDatasetActionContextMenu({
        hideContextMenu,
        datasets,
        reloadDataset,
      });
    } else if (folder != null) {
      menu = generateSettingsForFolder(folder, datasetCollectionContext, editFolder, true);
    }
  }

  if (inputRef == null || inputRef.current == null) return null;
  const refContent = inputRef.current;

  return (
    <React.Fragment>
      <Shortcut supportInputElements keys="escape" onTrigger={hideContextMenu} />
      <Dropdown
        menu={menu}
        overlayClassName="dropdown-overlay-container-for-context-menu"
        open={contextMenuPosition != null}
        getPopupContainer={() => refContent}
        destroyPopupOnHide
      >
        <div />
      </Dropdown>
    </React.Fragment>
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
export const DraggableDatasetType = "DraggableDatasetRow";

function isRecordADataset(record: DatasetOrFolder): record is APIDatasetCompact {
  return (record as APIDatasetCompact).folderId !== undefined;
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
    this.convertImageURLtoDataURL("/assets/images/file-light.png").then((dataURL) => {
      this.lightIcon = dataURL;
    });
    this.convertImageURLtoDataURL("/assets/images/file-dark.png").then((dataURL) => {
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
  const ref = React.useRef<HTMLTableRowElement>(null);
  const theme = useWkSelector((state) => state.uiInformation.theme);
  // @ts-ignore

  const datasetId = restProps["data-row-key"];
  const dragItem: DnDDropItemProps = { index, datasetId };
  const [, drag, preview] = useDrag({
    item: dragItem,
    type: DraggableDatasetType,
    canDrag: () => isADataset,
  });
  const [collectedProps, drop] = useDatasetDrop(rowKey, !isADataset);

  const { canDrop, isOver } = collectedProps;
  drop(drag(ref));
  const fileIcon = DragPreviewProvider.getProvider().getIcon(theme);
  const styleWithMaybeMoveCursor = isADataset
    ? { ...style, cursor: "move" }
    : { ...style, cursor: "not-allowed !important" };
  return (
    <tr
      ref={ref}
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
      <Tooltip
        title={
          <>
            The storage may be zero because:
            <ul>
              <li>The storage hasn't been scanned yet</li>
              <li>The data is streamed from outside sources</li>
              <li>It’s counted in other datasets</li>
              <li>The dataset belongs to another organization</li>
            </ul>
          </>
        }
      >
        {formattedBytes}
      </Tooltip>
    );
  }
  renderTypeColumn(): React.ReactNode {
    return <FileOutlined style={{ fontSize: "18px" }} />;
  }
  renderNameColumn(): React.ReactNode {
    const selectedLayerName: string | null = this.data.isActive
      ? this.data.colorLayerNames[0] || this.data.segmentationLayerNames[0]
      : null;
    const imgSrc = selectedLayerName
      ? `/api/datasets/${this.data.id}/layers/${selectedLayerName}/thumbnail?w=${2 * THUMBNAIL_SIZE}&h=${2 * THUMBNAIL_SIZE}`
      : "/assets/images/inactive-dataset-thumbnail.svg";
    const iconClassName = selectedLayerName ? "" : " icon-thumbnail";

    return (
      <>
        <Link to={`/datasets/${getReadableURLPart(this.data)}/view`} title="View Dataset">
          <img
            src={imgSrc}
            className={`dataset-table-thumbnail ${iconClassName}`}
            style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE }}
            alt=""
          />
        </Link>
        <div className="dataset-table-name-container">
          <Link
            to={`/datasets/${getReadableURLPart(this.data)}/view`}
            title="View Dataset"
            className="incognito-link dataset-table-name"
          >
            {this.data.name}
          </Link>

          {this.renderTags()}
          {this.datasetTable.props.context.globalSearchQuery != null ? (
            <>
              <br />
              <BreadcrumbsTag parts={this.datasetTable.props.context.getBreadcrumbs(this.data)} />
            </>
          ) : null}
        </div>
      </>
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
      <Tooltip title="No tags available for inactive datasets">
        <WarningOutlined
          style={{
            color: "@disabled-color",
          }}
        />
      </Tooltip>
    );
  }
  renderCreationDateColumn(): React.ReactNode {
    return <FormattedDate timestamp={this.data.created} />;
  }
  renderActionsColumn(): React.ReactNode {
    return (
      <DatasetActionView
        dataset={this.data}
        reloadDataset={this.datasetTable.reloadSingleDataset}
      />
    );
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
  renderNameColumn(): React.ReactNode {
    return (
      <>
        <img
          src={"/assets/images/folder-thumbnail.svg"}
          className="dataset-table-thumbnail icon-thumbnail"
          style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE }}
          alt=""
        />
        <div className="dataset-table-name-container">
          <span className="incognito-link dataset-table-name">{this.data.name}</span>
        </div>
      </>
    );
  }
  renderStorageColumn(): React.ReactNode {
    return null;
  }
  renderCreationDateColumn(): React.ReactNode {
    return null;
  }
  renderActionsColumn(): React.ReactNode {
    return this.datasetTable.getFolderSettingsActions(this.data);
  }
}

class DatasetTable extends React.PureComponent<Props, State> {
  state: State = {
    sortedInfo: {
      columnKey: useLruRank ? undefined : "created",
      order: "descend",
    },
    prevSearchQuery: "",
    contextMenuPosition: null,
    datasetsForContextMenu: [],
    folderForContextMenu: null,
  };
  // currentPageData is only used for range selection (and not during
  // rendering). That's why it's not included in this.state (also it
  // would lead to infinite loops, too).
  currentPageData: RowRenderer[] = [];
  getIsUserAdminOrDatasetManager(): boolean {
    return this.props.isUserAdmin || this.props.isUserDatasetManager;
  }

  static getDerivedStateFromProps(nextProps: Props, prevState: State): Partial<State> {
    const maybeSortedInfo: { sortedInfo: SorterResult<string> } | EmptyObject = // Clear the sorting exactly when the search box is initially filled
      // (searchQuery changes from empty string to non-empty string)
      nextProps.searchQuery !== "" && prevState.prevSearchQuery === ""
        ? {
            sortedInfo: {
              columnKey: "",
              order: "ascend",
            },
          }
        : {};
    return {
      prevSearchQuery: nextProps.searchQuery,
      ...maybeSortedInfo,
    };
  }

  handleChange = <RecordType extends object = any>(
    _pagination: TablePaginationConfig,
    _filters: Record<string, FilterValue | null>,
    sorter: SorterResult<RecordType> | SorterResult<RecordType>[],
  ) => {
    this.setState({
      // @ts-ignore
      sortedInfo: sorter,
    });
  };

  reloadSingleDataset = (datasetId: string): Promise<void> => this.props.reloadDataset(datasetId);

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
        const notIncludedTags = _.difference(this.props.searchTags, dataset.tags);

        return notIncludedTags.length === 0;
      });

    const filterByHasLayers = (datasets: APIDatasetCompact[]) =>
      this.getIsUserAdminOrDatasetManager()
        ? datasets
        : datasets.filter((dataset) => dataset.isActive);

    return filteredByTags(filterByMode(filterByHasLayers(this.props.datasets)));
  }

  renderEmptyText(): React.ReactNode {
    const maybeWarning =
      this.props.datasetFilteringMode !== "showAllDatasets" ? (
        <p>
          Note that datasets are currently filtered according to whether they are available on the
          datastore.
          <br />
          You can change the filtering via the menu next to the search input.
        </p>
      ) : null;
    return (
      <>
        {"queries" in this.props.context ? <p>This folder is empty.</p> : <p>No Datasets found.</p>}

        {maybeWarning}
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

  editFolder(folder: FolderItemWithName) {
    const { setFolderIdForEditModal } = this.props;
    setFolderIdForEditModal(folder.key);
  }

  getFolderSettingsActions(folder: FolderItemWithName): React.ReactNode {
    const { context } = this.props;
    const folderTreeContextMenuItems = generateSettingsForFolder(
      folder,
      context,
      () => this.editFolder(folder),
      true,
    );
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
    const { sortedInfo } = this.state;
    let dataSourceSortedByRank: Array<DatasetOrFolder> = useLruRank
      ? _.sortBy(filteredDataSource, ["lastUsedByUser", "created"]).reverse()
      : filteredDataSource;
    const isSearchQueryLongEnough = this.props.searchQuery.length >= MINIMUM_SEARCH_QUERY_LENGTH;
    if (!isSearchQueryLongEnough) {
      dataSourceSortedByRank = dataSourceSortedByRank.concat(activeSubfolders);
    }
    // Create a map from dataset to its rank
    const datasetToRankMap: Map<DatasetOrFolder, number> = new Map(
      dataSourceSortedByRank.map((dataset, rank) => [dataset, rank]),
    );
    const sortedDataSource =
      // Sort using the dice coefficient if the table is not sorted by another key
      // and if the query is at least 3 characters long to avoid sorting *all* datasets
      isSearchQueryLongEnough && sortedInfo.columnKey == null
        ? _.chain([...filteredDataSource, ...activeSubfolders])
            .map((datasetOrFolder) => {
              const diceCoefficient = dice(datasetOrFolder.name, this.props.searchQuery);
              const rank = useLruRank ? datasetToRankMap.get(datasetOrFolder) || 0 : 0;
              const rankCoefficient = 1 - rank / filteredDataSource.length;
              const coefficient = (diceCoefficient + rankCoefficient) / 2;
              return {
                datasetOrFolder,
                coefficient,
              };
            })
            .sortBy("coefficient")
            .map(({ datasetOrFolder }) => datasetOrFolder)
            .reverse()
            .value()
        : dataSourceSortedByRank;
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
        title: "Name",
        dataIndex: "name",
        key: "name",
        sorter: Utils.localeCompareBy<RowRenderer>((rowRenderer) => rowRenderer.data.name),
        sortOrder: sortedInfo.columnKey === "name" ? sortedInfo.order : undefined,
        render: (_name: string, rowRenderer: RowRenderer, _index) => rowRenderer.renderNameColumn(),
      },
      {
        width: 180,
        title: "Creation Date",
        dataIndex: "created",
        key: "created",
        sorter: Utils.compareBy<RowRenderer>((rowRenderer) =>
          isRecordADataset(rowRenderer.data) ? rowRenderer.data.created : 0,
        ),
        sortOrder: sortedInfo.columnKey === "created" ? sortedInfo.order : undefined,
        render: (_created, rowRenderer: RowRenderer) => rowRenderer.renderCreationDateColumn(),
      },
      {
        width: 200,
        title: "Actions",
        key: "actions",
        fixed: "right",
        render: (__, rowRenderer: RowRenderer) => rowRenderer.renderActionsColumn(),
      },
    ];
    if (
      this.getIsUserAdminOrDatasetManager() &&
      context.usedStorageInOrga != null &&
      context.usedStorageInOrga > 0
    ) {
      const datasetStorageSizeColumn = {
        title: (
          <Space>
            Used Storage{" "}
            <Tooltip title={"Storage used by this dataset within your organization."}>
              <InfoCircleOutlined />
            </Tooltip>{" "}
          </Space>
        ),
        key: "storage",
        width: 200,
        render: (_: any, rowRenderer: RowRenderer) => {
          return isRecordADataset(rowRenderer.data) ? rowRenderer.renderStorageColumn() : null;
        },
        sorter: Utils.compareBy<RowRenderer>((rowRenderer) =>
          isRecordADataset(rowRenderer.data) && rowRenderer.data.usedStorageBytes
            ? rowRenderer.data.usedStorageBytes
            : 0,
        ),
        sortOrder: sortedInfo.columnKey === "storage" ? sortedInfo.order : undefined,
      };
      columns.splice(2, 0, datasetStorageSizeColumn);
    }

    return (
      <DndProvider backend={HTML5Backend}>
        <ContextMenuContainer
          hideContextMenu={() => {
            this.setState({ contextMenuPosition: null });
          }}
          datasets={datasetsForContextMenu}
          folder={folderForContextMenu}
          reloadDataset={this.props.reloadDataset}
          contextMenuPosition={contextMenuPosition}
          datasetCollectionContext={context}
          editFolder={
            folderForContextMenu != null ? () => this.editFolder(folderForContextMenu) : () => {}
          }
        />
        <FixedExpandableTable
          expandable={{ childrenColumnName: "notUsed" }}
          dataSource={sortedDataSourceRenderers}
          columns={columns}
          rowKey={(renderer: RowRenderer) => renderer.getRowKey()}
          components={components}
          pagination={{
            defaultPageSize: 50,
          }}
          className="hide-checkbox-selection"
          onChange={this.handleChange}
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
                  const closestSelectedDatasetIdx = _.minBy(selectedIndices, (idx) =>
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
                  window.location.href = `/datasets/${getReadableURLPart(data)}/view`;
                } else {
                  context.setActiveFolderId(data.key);
                }
              },
            };
          }}
          rowSelection={{
            selectedRowKeys,
            onSelectNone: () => {
              this.props.onSelectDataset(null);
              context.setSelectedFolder(null);
            },
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
      const newTags = _.without(dataset.tags, tag);
      updater = {
        tags: newTags,
      };
    }

    updateDataset(dataset.id, updater);
  };

  return (
    <div className="tags-container">
      {dataset.tags.map((tag) => (
        <CategorizationLabel
          tag={tag}
          key={tag}
          kind="datasets"
          onClick={_.partial(onClickTag || _.noop, tag)}
          onClose={_.partial(editTagFromDataset, false, tag)}
          closable={dataset.isEditable}
        />
      ))}
      {dataset.isEditable ? (
        <EditableTextIcon
          icon={<PlusOutlined />}
          onChange={_.partial(editTagFromDataset, true)}
          label="Add Tag"
        />
      ) : null}
    </div>
  );
}

export function DatasetLayerTags({ dataset }: { dataset: APIMaybeUnimportedDataset }) {
  return (
    <div style={{ maxWidth: 250 }}>
      {(dataset.isActive ? dataset.dataSource.dataLayers : []).map((layer) => (
        <Tag
          key={layer.name}
          style={{
            maxWidth: 250,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {layer.name} - {layer.elementClass}
        </Tag>
      ))}
    </div>
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
    return <Tag>{emptyValue}</Tag>;
  }

  const allowedTeamsById = _.keyBy(dataset.allowedTeams, "id");
  return (
    <>
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
              color={stringToColor(team.name)}
            >
              {team.name}
              {isCumulative ? "*" : ""}
            </Tag>
          </Tooltip>
        );
      })}
    </>
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
      <Tag style={{ marginTop: "5px" }}>
        <FolderOpenOutlined className="icon-margin-right" />
        {formatPath(parts)}
      </Tag>
    </Tooltip>
  );
}

export default DatasetTable;
