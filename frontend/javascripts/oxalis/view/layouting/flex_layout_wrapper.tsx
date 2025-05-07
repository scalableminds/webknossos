import { sendAnalyticsEvent } from "admin/rest_api";
import { Layout } from "antd";
import FastTooltip from "components/fast_tooltip";
import features from "features";
import * as FlexLayout from "flexlayout-react";
import type { BorderNode, TabNode, TabSetNode } from "flexlayout-react";
import { InputKeyboardNoLoop } from "libs/input";
import Toast from "libs/toast";
import _ from "lodash";
import messages from "messages";
import type { OrthoView } from "oxalis/constants";
import { ArbitraryViews, BorderTabs, OrthoViews } from "oxalis/constants";
import { setBorderOpenStatusAction } from "oxalis/model/actions/ui_actions";
import { setViewportAction } from "oxalis/model/actions/view_mode_actions";
import type { BorderOpenStatus, BusyBlockingInfo, WebknossosState } from "oxalis/store";
import Store from "oxalis/store";
import InputCatcher from "oxalis/view/input_catcher";
import type { LayoutKeys } from "oxalis/view/layouting/default_layout_configs";
import {
  DEFAULT_LAYOUT_NAME,
  getTabDescriptorForBorderTab,
  resetDefaultLayouts,
} from "oxalis/view/layouting/default_layout_configs";
import ControlsAndRenderingSettingsTab from "oxalis/view/left-border-tabs/controls_and_rendering_settings_tab";
import LayerSettingsTab from "oxalis/view/left-border-tabs/layer_settings_tab";
import RecordingSwitch from "oxalis/view/recording_switch";
import AbstractTreeTab from "oxalis/view/right-border-tabs/abstract_tree_tab";
import BoundingBoxTab from "oxalis/view/right-border-tabs/bounding_box_tab";
import CommentTabView from "oxalis/view/right-border-tabs/comment_tab/comment_tab_view";
import ConnectomeView from "oxalis/view/right-border-tabs/connectome_tab/connectome_view";
import DatasetInfoTabView from "oxalis/view/right-border-tabs/dataset_info_tab_view";
import SegmentsView from "oxalis/view/right-border-tabs/segments_tab/segments_view";
import SkeletonTabView from "oxalis/view/right-border-tabs/trees_tab/skeleton_tab_view";
import Statusbar from "oxalis/view/statusbar";
import TDViewControls from "oxalis/view/td_view_controls";
import * as React from "react";
import { connect } from "react-redux";
import type { Dispatch } from "redux";
import BorderToggleButton from "../components/border_toggle_button";
import {
  adjustModelToBorderOpenStatus,
  getBorderOpenStatus,
  getMaximizedItemId,
  getPositionStatusOf,
} from "./flex_layout_helper";
import { getLayoutConfig, layoutEmitter } from "./layout_persistence";

const { Footer } = Layout;

type Model = InstanceType<typeof FlexLayout.Model>;
type Action = InstanceType<typeof FlexLayout.Action>;
type StateProps = {
  displayScalebars: boolean;
  isUpdateTracingAllowed: boolean;
  busyBlockingInfo: BusyBlockingInfo;
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
const ignoredLayoutChangesByAnalytics = ["FlexLayout_SetActiveTabset", "FlexLayout_SelectTab"];
type BorderOpenStatusKeys = keyof BorderOpenStatus;

class FlexLayoutWrapper extends React.PureComponent<Props, State> {
  unbindListeners: Array<() => void>;
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
    props.setBorderOpenStatus(_.cloneDeep(this.borderOpenStatusWhenNotMaximized));
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
  }

  addListeners() {
    this.unbindListeners.push(
      layoutEmitter.on("resetLayout", () => {
        resetDefaultLayouts();
        this.rebuildLayout();
      }),
    );
    this.unbindListeners.push(
      layoutEmitter.on("toggleBorder", (side) => {
        this.toggleBorder(side);
      }),
    );
    this.unbindListeners.push(
      layoutEmitter.on("toggleMaximize", () => {
        this.toggleMaximize();
      }),
    );
    this.unbindListeners.push(this.attachKeyboardShortcuts());
  }

  unbindAllListeners() {
    this.unbindListeners.forEach((unbind) => unbind());
  }

  loadCurrentModel() {
    const { layoutName, layoutKey } = this.props;
    const layout = getLayoutConfig(layoutKey, layoutName);
    const model = FlexLayout.Model.fromJson(layout);
    return model;
  }

  adaptModelToConditionalTabs(model: Model) {
    /*
     * Currently, this method only adapts the visibility/existence of the
     * ConnectomeTab. It is controlled by the features attributes in
     * application.conf (see `optInTabs`).
     * In the future, this method can be adapted to handle the existence of
     * tabs, too.
     */
    const rightBorderId = "right-border-tab-container";
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'getExtraData' does not exist on type 'No... Remove this comment to see the full error message
    const rightBorderModel = model.getNodeById(rightBorderId).getExtraData().model;

    if (rightBorderModel == null) {
      return;
    }

    const optInTabs: Array<string> = features().optInTabs || [];
    const showConnectomeTab = optInTabs.indexOf(BorderTabs.ConnectomeView.id) > -1;
    const connectomeTabDescriptor = getTabDescriptorForBorderTab(BorderTabs.ConnectomeView);
    const node = rightBorderModel.getNodeById(connectomeTabDescriptor.id);

    if (node && !showConnectomeTab) {
      // Tab exists, but shouldn't. Delete it.
      rightBorderModel.doAction(FlexLayout.Actions.deleteTab(connectomeTabDescriptor.id));
    } else if (!node && showConnectomeTab) {
      // Tab does not exist, but should. Add it next to the info tab.
      const datasetInfoTabId = BorderTabs.DatasetInfoTabView.id;
      const infoTabNode = rightBorderModel.getNodeById(datasetInfoTabId);

      if (!infoTabNode) {
        console.warn(`Could not find tab with id=${datasetInfoTabId}.`);
        return;
      }

      const targetId = infoTabNode.getParent().getId();
      rightBorderModel.doAction(
        FlexLayout.Actions.addNode(
          connectomeTabDescriptor,
          targetId, // Don't create a new tab set, but add it to the existing one.
          FlexLayout.DockLocation.CENTER,
          -1, // Add it to the end.
          false, // Don't focus it.
        ),
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
    const activeNode = model.getActiveTabset();

    if (activeNode == null) {
      return;
    }

    const toggleMaximiseAction = FlexLayout.Actions.maximizeToggle(activeNode.getId());
    model.doAction(toggleMaximiseAction);
    this.onAction(toggleMaximiseAction);
  };

  attachKeyboardShortcuts() {
    const keyboardNoLoop = new InputKeyboardNoLoop(
      {
        ".": this.toggleMaximize,
        k: () => this.toggleBorder("left"),
        l: () => this.toggleBorder("right"),
      },
      {
        supportInputElements: false,
      },
    );
    return () => keyboardNoLoop.destroy();
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
    const { displayScalebars, isUpdateTracingAllowed, busyBlockingInfo } = this.props;

    switch (id) {
      case OrthoViews.PLANE_XY:
      case OrthoViews.PLANE_YZ:
      case OrthoViews.PLANE_XZ: {
        return (
          <InputCatcher
            busyBlockingInfo={busyBlockingInfo}
            viewportID={id}
            displayScalebars={displayScalebars}
          />
        );
      }

      case OrthoViews.TDView: {
        return (
          <InputCatcher
            busyBlockingInfo={busyBlockingInfo}
            viewportID={id}
            displayScalebars={displayScalebars}
          >
            <TDViewControls />
          </InputCatcher>
        );
      }

      case ArbitraryViews.arbitraryViewport: {
        return (
          <InputCatcher
            busyBlockingInfo={busyBlockingInfo}
            viewportID={ArbitraryViews.arbitraryViewport}
          >
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

  renderSubLayout(node: Record<string, any>) {
    let { model } = node.getExtraData();

    if (model == null) {
      model = FlexLayout.Model.fromJson(node.getConfig().model);
      node.getExtraData().model = model;
    }

    return (
      <FlexLayout.Layout
        model={model}
        factory={(...args) => this.layoutFactory(...args)}
        titleFactory={(renderedNode) => (
          <FastTooltip title={BorderTabs[renderedNode.getId()].description}>
            {renderedNode.getName()}{" "}
          </FastTooltip>
        )}
        onModelChange={() => {
          // Update / inform parent layout about the changes.
          // This will trigger the parents onModelChange and this will then save the model changes.
          this.state.model.doAction(
            FlexLayout.Actions.updateNodeAttributes(node.getId(), {
              config: {
                model: node.getExtraData().model.toJson(),
              },
            }),
          );
        }}
      />
    );
  }

  layoutFactory(node: Record<string, any>): React.ReactNode | null | undefined {
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
    const currentLayoutModel = _.cloneDeep(this.state.model.toJson());

    // Workaround so that onLayoutChange is called after the update of flexlayout.
    // Calling the method without a timeout results in incorrect calculation of the viewport positions for the rendering.
    setTimeout(() => this.props.onLayoutChange(currentLayoutModel, this.props.layoutName), 1);
  };

  onMaximizeToggle = () => {
    const currentBorderOpenStatus = Store.getState().uiInformation.borderOpenStatus;
    const isMaximizing = this.maximizedItemId != null;
    // If a tab is maximized, this.borderOpenStatusWhenNotMaximized will not change and therefore save the BorderOpenStatus before maximizing.
    Object.entries(this.borderOpenStatusWhenNotMaximized).forEach(
      // @ts-ignore Typescript doesn't infer the type of side to "left" | "right" but only string, instead
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
            // @ts-ignore Typescript doesn't agree that toggledViewportId exists in OrthoViews
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
    const borderOpenStatusCopy = _.cloneDeep(Store.getState().uiInformation.borderOpenStatus);

    borderOpenStatusCopy[side] = !borderOpenStatusCopy[side];
    this.props.setBorderOpenStatus(borderOpenStatusCopy);

    if (toggleInternalState && this.maximizedItemId == null) {
      // Only adjust the internal state if the toggle is not automated and no tab is maximized.
      this.borderOpenStatusWhenNotMaximized[side] = !this.borderOpenStatusWhenNotMaximized[side];
    }

    this.state.model.doAction(FlexLayout.Actions.selectTab(`${side}-border-tab-container`));
    this.onLayoutChange();
  }

  onRenderTabSet = (
    tabSetNode: TabSetNode | BorderNode,
    renderValues: {
      buttons: Array<React.ReactNode>;
      headerContent?: React.ReactNode;
    },
  ) => {
    const { isTopMost, isRightMost } = getPositionStatusOf(tabSetNode);

    if (isTopMost && isRightMost) {
      renderValues.buttons.push(
        <BorderToggleButton
          side="right"
          onClick={() => this.toggleBorder("right")}
          key="right-border-toggle-button-top"
        />,
      );
    }
  };

  onRenderTab = (tabNode: TabNode, renderValues: Record<string, any>) => {
    const parent = tabNode.getParent();

    if (parent?.getType() !== "tabset") {
      // Do not consider borders, only tabsets in the center layout.
      return;
    }

    const parentTabSetNode = parent;

    if (parentTabSetNode.getChildren()[0].getId() === tabNode.getId()) {
      // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'Node' is not assignable to param... Remove this comment to see the full error message
      const { isTopMost, isLeftMost } = getPositionStatusOf(parentTabSetNode);

      if (isTopMost && isLeftMost) {
        renderValues.leading = (
          <BorderToggleButton side="left" onClick={() => this.toggleBorder("left")} />
        );
      }
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
      <React.Fragment>
        <div className="flex-layout-container">
          <FlexLayout.Layout
            model={model}
            factory={(...args) => this.layoutFactory(...args)}
            onModelChange={() => this.onLayoutChange()}
            onAction={this.onAction}
            onRenderTabSet={this.onRenderTabSet}
            onRenderTab={this.onRenderTab}
            classNameMapper={this.classNameMapper}
          />
        </div>
        <Footer className="statusbar-footer">
          <BorderToggleButton side="left" onClick={() => this.toggleBorder("left")} inFooter />
          <BorderToggleButton side="right" onClick={() => this.toggleBorder("right")} inFooter />
          <Statusbar />
        </Footer>
      </React.Fragment>
    );
  }
}

function mapStateToProps(state: WebknossosState): StateProps {
  return {
    displayScalebars: state.userConfiguration.displayScalebars,
    isUpdateTracingAllowed: state.annotation.restrictions.allowUpdate,
    busyBlockingInfo: state.uiInformation.busyBlockingInfo,
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
