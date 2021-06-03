// @flow
import * as React from "react";
import FlexLayout, { TabNode, TabSetNode } from "flexlayout-react";
import { connect } from "react-redux";
import type { Dispatch } from "redux";
import Store, { type OxalisState, type BorderOpenStatus } from "oxalis/store";
import { Layout } from "antd";
import _ from "lodash";
import Toast from "libs/toast";
import messages from "messages";
import { setBorderOpenStatusAction } from "oxalis/model/actions/ui_actions";
import { InputKeyboardNoLoop } from "libs/input";
import {
  DEFAULT_LAYOUT_NAME,
  type LayoutKeys,
  resetDefaultLayouts,
} from "oxalis/view/layouting/default_layout_configs";

import Statusbar from "oxalis/view/statusbar";
import { OrthoViews, ArbitraryViews } from "oxalis/constants";
import AbstractTreeTab from "oxalis/view/right-border-tabs/abstract_tree_tab";
import CommentTabView from "oxalis/view/right-border-tabs/comment_tab/comment_tab_view";
import DatasetInfoTabView from "oxalis/view/right-border-tabs/dataset_info_tab_view";
import InputCatcher from "oxalis/view/input_catcher";
import MeshesView from "oxalis/view/right-border-tabs/meshes_view";
import SkeletonTabView from "oxalis/view/right-border-tabs/skeleton_tab_view";
import BoundingBoxTab from "oxalis/view/right-border-tabs/bounding_box_tab";
import RecordingSwitch from "oxalis/view/recording_switch";
import LayerSettingsTab from "oxalis/view/left-border-tabs/layer_settings_tab";
import ControlsAndRenderingSettingsTab from "oxalis/view/left-border-tabs/controls_and_rendering_settings_tab";
import TDViewControls from "oxalis/view/td_view_controls";

import { sendAnalyticsEvent } from "admin/admin_rest_api";
import { layoutEmitter, getLayoutConfig } from "./layout_persistence";
import BorderToggleButton from "../components/border_toggle_button";
import {
  getMaximizedItemId,
  getBorderOpenStatus,
  adjustModelToBorderOpenStatus,
  getPositionStatusOf,
} from "./flex_layout_helper";

const { Footer } = Layout;
type Model = typeof FlexLayout.Model;
type Action = typeof FlexLayout.Action;

type StateProps = {|
  displayScalebars: boolean,
  isUpdateTracingAllowed: boolean,
|};

type OwnProps = {|
  layoutKey: LayoutKeys,
  layoutName: string,
  onLayoutChange: (model: Object, layoutName: string) => void,
|};
type DispatchProps = {|
  setBorderOpenStatus: BorderOpenStatus => void,
|};
type Props = {| ...OwnProps, ...StateProps, ...DispatchProps |};
type State = {
  model: Model,
};

class FlexLayoutWrapper extends React.PureComponent<Props, State> {
  unbindListeners: Array<() => void>;
  // This variable stores the border open status that should be active, when no main tab is maximized.
  // It is used to compare with the actual border open status that is stored in the store.
  borderOpenStatusWhenNotMaximized: BorderOpenStatus = { left: false, right: false };
  maximizedItemId: ?string = null;

  constructor(props: Props) {
    super(props);
    const model = this.loadCurrentModel();
    this.unbindListeners = [];
    this.addListeners();
    this.borderOpenStatusWhenNotMaximized = getBorderOpenStatus(model);
    props.setBorderOpenStatus(_.cloneDeep(this.borderOpenStatusWhenNotMaximized));
    this.updateToModelStateAndAdjustIt(model);
    this.state = { model };
  }

  componentDidUpdate(prevProps: Props) {
    const { layoutName, layoutKey } = this.props;
    if (layoutName !== prevProps.layoutName || layoutKey !== prevProps.layoutKey) {
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
      layoutEmitter.on("toggleBorder", side => {
        this.toggleBorder(side);
      }),
    );
    this.unbindListeners.push(this.attachMaximizeListener());
  }

  unbindAllListeners() {
    this.unbindListeners.forEach(unbind => unbind());
  }

  loadCurrentModel() {
    const { layoutName, layoutKey } = this.props;
    if (layoutName !== DEFAULT_LAYOUT_NAME) {
      sendAnalyticsEvent("load_custom_layout", { viewMode: this.props.layoutKey });
    }
    const layout = getLayoutConfig(layoutKey, layoutName);
    const model = FlexLayout.Model.fromJson(layout);
    return model;
  }

  updateToModelStateAndAdjustIt(model: Model) {
    this.maximizedItemId = getMaximizedItemId(model);
    adjustModelToBorderOpenStatus(model, this.borderOpenStatusWhenNotMaximized);
    model.setOnAllowDrop(this.allowDrop);
    return model;
  }

  rebuildLayout() {
    const model = this.loadCurrentModel();
    this.updateToModelStateAndAdjustIt(model);
    this.setState({ model });
    setTimeout(this.onLayoutChange, 1);
  }

  attachMaximizeListener() {
    const toggleMaximize = () => {
      const { model } = this.state;
      const activeNode = model.getActiveTabset();
      if (activeNode == null) {
        return;
      }
      const toggleMaximiseAction = FlexLayout.Actions.maximizeToggle(activeNode.getId());
      model.doAction(toggleMaximiseAction);
      this.onAction(toggleMaximiseAction);
    };

    const keyboardNoLoop = new InputKeyboardNoLoop(
      { ".": toggleMaximize },
      { supportInputElements: false },
    );
    return () => keyboardNoLoop.destroy();
  }

  // Taken from the FlexLayout examples.
  allowDrop(dragNode: Object, dropInfo: Object) {
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

  renderBorderTab(id: string): ?React.Node {
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
      case "MeshesView": {
        return <MeshesView />;
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
      default: {
        console.error(`The tab with id ${id} is unknown.`);
        return null;
      }
    }
  }

  renderViewport(id: string): ?React.Node {
    const { displayScalebars, isUpdateTracingAllowed } = this.props;
    switch (id) {
      case OrthoViews.PLANE_XY:
      case OrthoViews.PLANE_YZ:
      case OrthoViews.PLANE_XZ: {
        return <InputCatcher viewportID={id} displayScalebars={displayScalebars} />;
      }
      case OrthoViews.TDView: {
        return (
          <InputCatcher viewportID={id} displayScalebars={displayScalebars}>
            <TDViewControls />
          </InputCatcher>
        );
      }
      case ArbitraryViews.arbitraryViewport: {
        return (
          <InputCatcher viewportID={ArbitraryViews.arbitraryViewport}>
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

  renderSubLayout(node: Object) {
    let { model } = node.getExtraData();
    if (model == null) {
      model = FlexLayout.Model.fromJson(node.getConfig().model);
      node.getExtraData().model = model;
    }
    return (
      <FlexLayout.Layout
        model={model}
        factory={(...args) => this.layoutFactory(...args)}
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

  layoutFactory(node: Object): ?React.Node {
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
    sendAnalyticsEvent("change_tracing_layout", { viewMode: this.props.layoutKey });
    const currentLayoutModel = _.cloneDeep(this.state.model.toJson());
    // Workaround so that onLayoutChange is called after the update of flexlayout.
    // Calling the method without a timeout results in incorrect calculation of the viewport positions for the rendering.
    setTimeout(() => this.props.onLayoutChange(currentLayoutModel, this.props.layoutName), 1);
  };

  onMaximizeToggle = () => {
    const currentBorderOpenStatus = Store.getState().uiInformation.borderOpenStatus;
    const isMaximizing = this.maximizedItemId != null;
    // If a tab is maximized, this.borderOpenStatusWhenNotMaximized will not change and therefore save the BorderOpenStatus before maximizing.
    Object.entries(this.borderOpenStatusWhenNotMaximized).forEach(([side, isOpen]) => {
      if ((isOpen && isMaximizing) || (!isMaximizing && currentBorderOpenStatus[side] !== isOpen)) {
        // Close all border if a tab is maximized and restore border status before maximizing.
        this.toggleBorder(side, false);
      }
    });
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
    }
    return action;
  };

  toggleBorder(side: string, toggleInternalState: boolean = true) {
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
    tabSetNode: typeof TabSetNode,
    renderValues: { buttons: Array<React.Node>, headerContent: React.Node },
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

  onRenderTab = (tabNode: typeof TabNode, renderValues: Object) => {
    const parent = tabNode.getParent();
    if (parent.getType() !== "tabset") {
      // Do not consider borders, only tabsets in the center layout.
      return;
    }
    const parentTabSetNode = parent;
    if (parentTabSetNode.getChildren()[0].getId() === tabNode.getId()) {
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

function mapStateToProps(state: OxalisState): StateProps {
  return {
    displayScalebars: state.userConfiguration.displayScalebars,
    isUpdateTracingAllowed: state.tracing.restrictions.allowUpdate,
  };
}
function mapDispatchToProps(dispatch: Dispatch<*>) {
  return {
    setBorderOpenStatus(borderOpenStatus: BorderOpenStatus) {
      dispatch(setBorderOpenStatusAction(borderOpenStatus));
    },
  };
}

export default connect<Props, OwnProps, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(FlexLayoutWrapper);
