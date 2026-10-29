import { sendAnalyticsEvent } from "admin/rest_api";
import { ConfigProvider, Layout } from "antd";
import features from "features";
import type { Action, BorderNode, TabNode, TabSetNode } from "flexlayout-react";
import { Actions, DockLocation, Layout as FlexLayoutComponent, Model } from "flexlayout-react";
import { InputKeyboard } from "libs/input";
import Toast from "libs/toast";
import cloneDeep from "lodash-es/cloneDeep";
import messages from "messages";
import type React from "react";
import { Fragment, PureComponent } from "react";
import { connect } from "react-redux";
import type { Dispatch } from "redux";
import { getAntdTheme } from "theme";
import type { BorderTabType, OrthoView } from "viewer/constants";
import { BorderTabs, FlightViews, OrthoViews } from "viewer/constants";
import {
  isUserInterfaceBlocked,
  mayEditAnnotation,
} from "viewer/model/accessors/annotation_accessor";
import { datasetHasConnectomes } from "viewer/model/accessors/connectome_accessor";
import { setBorderOpenStatusAction } from "viewer/model/actions/ui_actions";
import { setViewportAction } from "viewer/model/actions/view_mode_actions";
import { listenToStoreProperty } from "viewer/model/helpers/listener_helpers";
import type { BorderOpenStatus, WebknossosState } from "viewer/store";
import Store from "viewer/store";
import InputCatcher from "viewer/view/input_catcher";
import type { LayoutKeys } from "viewer/view/layouting/default_layout_configs";
import {
  DEFAULT_LAYOUT_NAME,
  getTabDescriptorForBorderTab,
  resetDefaultLayouts,
} from "viewer/view/layouting/default_layout_configs";
import ControlsAndRenderingSettingsTab from "viewer/view/left_border_tabs/controls_and_rendering_settings_tab";
import LayerSettingsTab from "viewer/view/left_border_tabs/layer_settings_tab";
import RecordingSwitch from "viewer/view/recording_switch";
import AbstractTreeTab from "viewer/view/right_border_tabs/abstract_tree_tab";
import BoundingBoxTab from "viewer/view/right_border_tabs/bounding_box_tab/bounding_box_tab";
import CommentTabView from "viewer/view/right_border_tabs/comment_tab/comment_tab_view";
import ConnectomeView from "viewer/view/right_border_tabs/connectome_tab/connectome_view";
import DatasetInfoTabView from "viewer/view/right_border_tabs/info_tab/dataset_info_tab_view";
import SegmentsView from "viewer/view/right_border_tabs/segments_tab/segments_tab_view";
import SkeletonTabView from "viewer/view/right_border_tabs/skeleton_tab/skeleton_tab_view";
import Statusbar from "viewer/view/statusbar/statusbar";
import TDViewControls from "viewer/view/td_view_controls";
import BorderToggleButton from "../components/border_toggle_button";
import type {
  KeyboardShortcutHandlerMap,
  KeyboardShortcutsMap,
} from "../keyboard_shortcuts/keyboard_shortcut_types";
import { buildKeyBindingsFromConfig } from "../keyboard_shortcuts/keyboard_shortcut_utils";
import {
  adjustModelToBorderOpenStatus,
  getBorderOpenStatus,
  getMaximizedItemId,
  getPositionStatusOf,
  getTabsetIdToToggleMaximize,
} from "./flex_layout_helper";
import { getLayoutConfig, LayoutEvents, layoutEmitter } from "./layout_persistence";

const { Footer } = Layout;

// type Model = InstanceType<typeof Model>;
// type Action = InstanceType<typeof Actions>;

type StateProps = {
  displayScalebars: boolean;
  isUpdateTracingAllowed: boolean;
  isBlocked: boolean;
};
type OwnProps = {
  layoutKey: LayoutKeys;
  layoutName: string;
  onLayoutChange: (model: Record<string, any>, layoutName: string) => void;
};
type DispatchProps = {
  setBorderOpenStatus: (arg0: BorderOpenStatus) => void;
  setActiveViewport: (arg0: OrthoView) => void;
};
type Props = OwnProps & StateProps & DispatchProps;
type State = {
  model: Model;
};
const rightBorderId = "right-border-tab-container";

// The model of a sub-layout (e.g., the content of a border) is created lazily, usually when the
// sub-layout is rendered for the first time. Create it here if it is accessed before that.
function getSubLayoutModel(node: TabNode): Model {
  const extraData = node.getExtraData();
  if (extraData.model == null) {
    extraData.model = Model.fromJson(node.getConfig().model);
  }
  return extraData.model;
}
const ignoredLayoutChangesByAnalytics = ["FlexLayout_SetActiveTabset", "FlexLayout_SelectTab"];
type BorderOpenStatusKeys = keyof BorderOpenStatus;

class FlexLayoutWrapper extends PureComponent<Props, State> {
  unbindListeners: Array<() => void>;
  keyboard?: InputKeyboard;
  // This variable stores the border open status that should be active, when no main tab is maximized.
  // It is used to compare with the actual border open status that is stored in the store.
  borderOpenStatusWhenNotMaximized: BorderOpenStatus = {
    left: false,
    right: false,
  };

  maximizedItemId: string | null | undefined = null;

  constructor(props: Props) {
    super(props);
    const model = this.loadCurrentModel();
    this.unbindListeners = [];
    this.addListeners();
    this.borderOpenStatusWhenNotMaximized = getBorderOpenStatus(model);
    props.setBorderOpenStatus(cloneDeep(this.borderOpenStatusWhenNotMaximized));
    this.updateToModelStateAndAdjustIt(model);
    this.state = {
      model,
    };
  }

  componentDidUpdate(prevProps: Props) {
    const { layoutName, layoutKey } = this.props;

    if (layoutName !== prevProps.layoutName || layoutKey !== prevProps.layoutKey) {
      sendAnalyticsEvent("switched_layout", {
        from: {
          viewMode: prevProps.layoutKey,
          layoutName: prevProps.layoutName,
        },
        to: {
          viewMode: layoutKey,
          layoutName,
        },
      });
      this.rebuildLayout();
    }
  }

  componentWillUnmount() {
    this.unbindAllListeners();
    this.keyboard?.destroy();
  }

  addListeners() {
    this.unbindListeners.push(
      layoutEmitter.on(LayoutEvents.resetLayout, () => {
        resetDefaultLayouts();
        this.rebuildLayout();
      }),
    );
    this.unbindListeners.push(
      layoutEmitter.on(LayoutEvents.toggleBorder, (side) => {
        this.toggleBorder(side);
      }),
    );
    this.unbindListeners.push(
      layoutEmitter.on(LayoutEvents.toggleMaximize, () => {
        this.toggleMaximize();
      }),
    );
    this.unbindListeners.push(
      layoutEmitter.on(LayoutEvents.showSkeletonTab, () => {
        this.openRightBorderTabById(BorderTabs.SkeletonTabView);
      }),
    );
    this.unbindListeners.push(
      layoutEmitter.on(LayoutEvents.showSegmentsTab, () => {
        this.openRightBorderTabById(BorderTabs.SegmentsView);
      }),
    );
    this.unbindListeners.push(
      layoutEmitter.on(LayoutEvents.showAbstractTreeTab, () => {
        this.openRightBorderTabById(BorderTabs.AbstractTreeTab, BorderTabs.SkeletonTabView);
      }),
    );
    this.unbindListeners.push(this.attachKeyboardShortcuts());
  }

  unbindAllListeners() {
    this.unbindListeners.forEach((unbind) => {
      unbind();
    });
  }

  loadCurrentModel() {
    const { layoutName, layoutKey } = this.props;
    const layout = getLayoutConfig(layoutKey, layoutName);
    const model = Model.fromJson(layout);
    return model;
  }

  private getRightBorderModel(model: Model): Model | null {
    const node = model.getNodeById(rightBorderId);
    if (node?.getType() !== "tab") return null;
    return getSubLayoutModel(node as TabNode);
  }

  // Adds the tab to the tabset that contains siblingTab, unless the tab already exists.
  private addRightBorderTab(
    rightBorderModel: Model,
    tabType: BorderTabType,
    siblingTab: BorderTabType,
    select: boolean,
  ) {
    const tabDescriptor = getTabDescriptorForBorderTab(tabType);
    if (rightBorderModel.getNodeById(tabDescriptor.id) != null) return;

    const siblingNode = rightBorderModel.getNodeById(siblingTab.id);
    const targetNode = siblingNode?.getParent() ?? rightBorderModel.getFirstTabSet();
    rightBorderModel.doAction(
      Actions.addNode(
        tabDescriptor,
        targetNode.getId(), // Don't create a new tab set, but add it to the existing one.
        DockLocation.CENTER,
        -1, // Add it to the end.
        select,
      ),
    );
  }

  // If the tab is not part of the layout (e.g., because it is not part of the default layout
  // or was closed), it is added next to tabToAddNextTo if given.
  openRightBorderTabById(tabType: BorderTabType, tabToAddNextTo?: BorderTabType) {
    const rightBorderModel = this.getRightBorderModel(this.state.model);
    if (rightBorderModel == null) return;
    if (rightBorderModel.getNodeById(tabType.id) == null) {
      if (tabToAddNextTo == null) return;
      this.addRightBorderTab(rightBorderModel, tabType, tabToAddNextTo, true);
    }

    const isRightOpen = getBorderOpenStatus(this.state.model).right;
    if (!isRightOpen) this.toggleBorder("right");
    rightBorderModel.doAction(Actions.selectTab(tabType.id));
  }

  adaptModelToConditionalTabs(model: Model) {
    /*
     * This method adapts the visibility/existence of the ConnectomeTab.
     * It is controlled by the features attributes in application.conf
     * (see `optInTabs`) and is only shown if the dataset has connectome files.
     * Also, it makes the AbstractTreeTab closable in layouts that were stored
     * before the tab became closable.
     */
    const rightBorderModel = this.getRightBorderModel(model);
    if (rightBorderModel == null) {
      return;
    }

    if (rightBorderModel.getNodeById(BorderTabs.AbstractTreeTab.id) != null) {
      rightBorderModel.doAction(
        Actions.updateNodeAttributes(BorderTabs.AbstractTreeTab.id, { enableClose: true }),
      );
    }

    const optInTabs: Array<string> = features().optInTabs || [];
    const showConnectomeTab =
      optInTabs.includes(BorderTabs.ConnectomeView.id) &&
      datasetHasConnectomes(Store.getState().dataset);
    const node = rightBorderModel.getNodeById(BorderTabs.ConnectomeView.id);

    if (node && !showConnectomeTab) {
      // Tab exists, but shouldn't. Delete it.
      rightBorderModel.doAction(Actions.deleteTab(BorderTabs.ConnectomeView.id));
    } else if (!node && showConnectomeTab) {
      // Tab does not exist, but should. Add it next to the info tab.
      this.addRightBorderTab(
        rightBorderModel,
        BorderTabs.ConnectomeView,
        BorderTabs.DatasetInfoTabView,
        false, // Don't focus it.
      );
    }
  }

  updateToModelStateAndAdjustIt(model: Model) {
    this.maximizedItemId = getMaximizedItemId(model);
    adjustModelToBorderOpenStatus(model, this.borderOpenStatusWhenNotMaximized);
    model.setOnAllowDrop(this.allowDrop);
    setTimeout(() => {
      this.adaptModelToConditionalTabs(model);
    }, 0);
    return model;
  }

  rebuildLayout() {
    const model = this.loadCurrentModel();
    this.updateToModelStateAndAdjustIt(model);
    this.setState({ model }, () => this.onLayoutChange());

    if (this.props.layoutName !== DEFAULT_LAYOUT_NAME) {
      sendAnalyticsEvent("load_custom_layout", {
        viewMode: this.props.layoutKey,
      });
    }
  }

  toggleMaximize = () => {
    const { model } = this.state;
    const { activeViewport } = Store.getState().viewModeData.plane;
    const tabsetId = getTabsetIdToToggleMaximize(model, activeViewport);

    if (tabsetId == null) {
      return;
    }

    const toggleMaximiseAction = Actions.maximizeToggle(tabsetId);
    model.doAction(toggleMaximiseAction);
    this.onAction(toggleMaximiseAction);
  };

  getLayoutKeyboardShortcuts(): Partial<KeyboardShortcutHandlerMap> {
    return {
      MAXIMIZE: { onPressed: this.toggleMaximize },
      TOGGLE_LEFT_BORDER: {
        onPressed: () => this.toggleBorder("left"),
      },
      TOGGLE_RIGHT_BORDER: {
        onPressed: () => this.toggleBorder("right"),
      },
    };
  }

  reloadLayoutKeyboardShortcuts(keyboardShortcutsConfig: KeyboardShortcutsMap) {
    if (this.keyboard) {
      this.keyboard.destroy();
    }
    const keyboardControls = buildKeyBindingsFromConfig(
      keyboardShortcutsConfig,
      this.getLayoutKeyboardShortcuts(),
    );
    this.keyboard = new InputKeyboard(keyboardControls);
  }

  attachKeyboardShortcuts() {
    return listenToStoreProperty(
      (state) => state.keyboardConfiguration.shortcutsConfig,
      (keyboardShortcutsConfig) => this.reloadLayoutKeyboardShortcuts(keyboardShortcutsConfig),
      true,
    );
  }

  // Taken from the FlexLayout examples.
  allowDrop(dragNode: Record<string, any>, dropInfo: Record<string, any>) {
    const dropNode = dropInfo.node;

    // Prevent center tabs being moved into a border.
    if (
      dropNode.getType() === "border" &&
      (dragNode.getParent() == null || dragNode.getParent().getType() !== "border")
    ) {
      Toast.info(messages["ui.moving_center_tab_into_border_error"]);
      return false;
    }

    // Prevent border tabs being moved into the center.
    if (
      dropNode.getType() !== "border" &&
      dragNode.getParent() != null &&
      dragNode.getParent().getType() === "border"
    ) {
      Toast.info(messages["ui.moving_border_tab_into_center_error"]);
      return false;
    }

    return true;
  }

  renderBorderTab(id: string): React.ReactNode | null | undefined {
    switch (id) {
      case "DatasetInfoTabView": {
        return <DatasetInfoTabView />;
      }

      case "CommentTabView": {
        return <CommentTabView />;
      }

      case "AbstractTreeTab": {
        return <AbstractTreeTab />;
      }

      case "SegmentsView": {
        return <SegmentsView />;
      }

      case "SkeletonTabView": {
        return <SkeletonTabView />;
      }

      case "BoundingBoxTab": {
        return <BoundingBoxTab />;
      }

      case "LayerSettingsTab": {
        return <LayerSettingsTab />;
      }

      case "ControlsAndRenderingSettingsTab": {
        return <ControlsAndRenderingSettingsTab />;
      }

      case "ConnectomeView": {
        return <ConnectomeView />;
      }

      default: {
        console.error(`The tab with id ${id} is unknown.`);
        return null;
      }
    }
  }

  renderViewport(id: string): React.ReactNode | null | undefined {
    const { displayScalebars, isUpdateTracingAllowed, isBlocked } = this.props;

    switch (id) {
      case OrthoViews.PLANE_XY:
      case OrthoViews.PLANE_YZ:
      case OrthoViews.PLANE_XZ: {
        return (
          <InputCatcher isBlocked={isBlocked} viewportID={id} displayScalebars={displayScalebars} />
        );
      }

      case OrthoViews.TDView: {
        return (
          <InputCatcher isBlocked={isBlocked} viewportID={id} displayScalebars={displayScalebars}>
            <TDViewControls />
          </InputCatcher>
        );
      }

      case FlightViews.flightViewport: {
        return (
          <InputCatcher isBlocked={isBlocked} viewportID={FlightViews.flightViewport}>
            {isUpdateTracingAllowed ? <RecordingSwitch /> : null}
          </InputCatcher>
        );
      }

      default: {
        console.error(`The settings tab with id ${id} is unknown.`);
        return null;
      }
    }
  }

  renderSubLayout(node: TabNode) {
    const model = getSubLayoutModel(node);

    return (
      <FlexLayoutComponent
        model={model}
        factory={(...args) => this.layoutFactory(...args)}
        onModelChange={() => {
          // Update / inform parent layout about the changes.
          // This will trigger the parents onModelChange and this will then save the model changes.
          this.state.model.doAction(
            Actions.updateNodeAttributes(node.getId(), {
              config: {
                model: node.getExtraData().model.toJson(),
              },
            }),
          );
        }}
      />
    );
  }

  layoutFactory(node: TabNode): React.ReactNode | null | undefined {
    const component = node.getComponent();
    const id = node.getId();

    switch (component) {
      case "border-tab": {
        return this.renderBorderTab(id);
      }

      case "viewport": {
        return this.renderViewport(id);
      }

      case "sub": {
        return this.renderSubLayout(node);
      }

      default: {
        return null;
      }
    }
  }

  onLayoutChange = () => {
    const currentLayoutModel = cloneDeep(this.state.model.toJson());

    // Workaround so that onLayoutChange is called after the update of flexlayout.
    // Calling the method without a timeout results in incorrect calculation of the viewport positions for the rendering.
    setTimeout(() => this.props.onLayoutChange(currentLayoutModel, this.props.layoutName), 50);
  };

  onMaximizeToggle = () => {
    const currentBorderOpenStatus = Store.getState().uiInformation.borderOpenStatus;
    const isMaximizing = this.maximizedItemId != null;
    // If a tab is maximized, this.borderOpenStatusWhenNotMaximized will not change and therefore save the BorderOpenStatus before maximizing.
    Object.entries(this.borderOpenStatusWhenNotMaximized).forEach(
      // @ts-expect-error Typescript doesn't infer the type of side to "left" | "right" but only string, instead
      ([side, isOpen]: [BorderOpenStatusKeys, boolean]) => {
        if (
          (isOpen && isMaximizing) ||
          (!isMaximizing && currentBorderOpenStatus[side] !== isOpen)
        ) {
          // Close all border if a tab is maximized and restore border status before maximizing.
          this.toggleBorder(side, false);
        }
      },
    );
  };

  onAction = (action: Action) => {
    const { type, data } = action;

    if (type === "FlexLayout_MaximizeToggle") {
      if (data.node === this.maximizedItemId) {
        this.maximizedItemId = null;
      } else {
        this.maximizedItemId = data.node;
      }

      this.onMaximizeToggle();

      if (document.activeElement) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'blur' does not exist on type 'Element'.
        document.activeElement.blur();
      }
      if (data?.node) {
        const node = this.state.model.getNodeById(data.node);
        if (node) {
          const toggledViewportId = node.getChildren()[0].getId();

          if (toggledViewportId in OrthoViews) {
            // @ts-expect-error Typescript doesn't agree that toggledViewportId exists in OrthoViews
            this.props.setActiveViewport(OrthoViews[toggledViewportId]);
          }
        }
      }
    }

    if (!ignoredLayoutChangesByAnalytics.includes(type)) {
      sendAnalyticsEvent("change_tracing_layout", {
        viewMode: this.props.layoutKey,
      });
    }

    return action;
  };

  toggleBorder(side: BorderOpenStatusKeys, toggleInternalState: boolean = true) {
    // The most recent version of borderOpenStatus is needed as two border toggles might be executed directly after another.
    // If borderOpenStatus was passed via props, the first update  of borderOpenStatus will overwritten by the second update.
    const borderOpenStatusCopy = cloneDeep(Store.getState().uiInformation.borderOpenStatus);

    borderOpenStatusCopy[side] = !borderOpenStatusCopy[side];
    this.props.setBorderOpenStatus(borderOpenStatusCopy);

    if (toggleInternalState && this.maximizedItemId == null) {
      // Only adjust the internal state if the toggle is not automated and no tab is maximized.
      this.borderOpenStatusWhenNotMaximized[side] = !this.borderOpenStatusWhenNotMaximized[side];
    }

    this.state.model.doAction(Actions.selectTab(`${side}-border-tab-container`));
    this.onLayoutChange();
  }

  onRenderTabSet = (
    tabSetNode: TabSetNode | BorderNode,
    renderValues: {
      leading?: React.ReactNode;
      buttons: Array<React.ReactNode>;
      stickyButtons: Array<React.ReactNode>;
      headerContent?: React.ReactNode;
    },
  ) => {
    const { isTopMost, isRightMost, isLeftMost } = getPositionStatusOf(tabSetNode);

    if (isTopMost && isRightMost) {
      renderValues.buttons.push(
        <BorderToggleButton side="right" key="right-border-toggle-button-top" />,
      );
    }

    if (isTopMost && isLeftMost) {
      renderValues.leading = <BorderToggleButton side="left" />;
    }
  };

  classNameMapper = (className: string) => {
    const isLeftSidebarOpen = getBorderOpenStatus(this.state.model).left;

    if (isLeftSidebarOpen && className === "flexlayout__splitter_border") {
      // Add an additional class to the border splitters to disable the pointer events (dragging) of the first splitter using css.
      return `${className} hide_first_splitter_border`;
    }

    return className;
  };

  render() {
    const { model } = this.state;
    return (
      <Fragment>
        <div className="flex-layout-container">
          <FlexLayoutComponent
            model={model}
            factory={(...args) => this.layoutFactory(...args)}
            onModelChange={() => this.onLayoutChange()}
            onAction={this.onAction}
            onRenderTabSet={this.onRenderTabSet}
            classNameMapper={this.classNameMapper}
          />
        </div>
        <ConfigProvider theme={getAntdTheme("dark")}>
          <Footer className="statusbar-footer">
            <Statusbar />
          </Footer>
        </ConfigProvider>
      </Fragment>
    );
  }
}

function mapStateToProps(state: WebknossosState): StateProps {
  return {
    displayScalebars: state.userConfiguration.displayScalebars,
    isUpdateTracingAllowed: mayEditAnnotation(state),
    isBlocked: isUserInterfaceBlocked(state),
  };
}

function mapDispatchToProps(dispatch: Dispatch<any>) {
  return {
    setBorderOpenStatus(borderOpenStatus: BorderOpenStatus) {
      dispatch(setBorderOpenStatusAction(borderOpenStatus));
    },

    setActiveViewport(viewport: OrthoView) {
      dispatch(setViewportAction(viewport));
    },
  };
}

const connector = connect(mapStateToProps, mapDispatchToProps);
export default connector(FlexLayoutWrapper);
