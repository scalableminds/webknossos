// @flow
import * as React from "react";
import FlexLayout from "flexlayout-react";
import { connect } from "react-redux";
import type { Dispatch } from "redux";
import Store, { type OxalisState, type AnnotationType, type BorderOpenStatus } from "oxalis/store";
import { Layout } from "antd";
import _ from "lodash";
import Toast from "libs/toast";
import messages from "messages";
import { setBorderOpenStatusAction } from "oxalis/model/actions/ui_actions";
import { InputKeyboardNoLoop } from "libs/input";

import { OrthoViews, ArbitraryViews } from "oxalis/constants";
import AbstractTreeTabView from "oxalis/view/right-menu/abstract_tree_tab_view";
import CommentTabView from "oxalis/view/right-menu/comment_tab/comment_tab_view";
import DatasetInfoTabView from "oxalis/view/right-menu/dataset_info_tab_view";
import InputCatcher from "oxalis/view/input_catcher";
import MappingInfoView from "oxalis/view/right-menu/mapping_info_view";
import MeshesView from "oxalis/view/right-menu/meshes_view";
import RecordingSwitch from "oxalis/view/recording_switch";
import DatasetSettingsView from "oxalis/view/settings/dataset_settings_view";
import UserSettingsView from "oxalis/view/settings/user_settings_view";
import TDViewControls from "oxalis/view/td_view_controls";
import TreesTabView from "oxalis/view/right-menu/trees_tab_view";
import { layoutEmitter, getLayoutConfig } from "./layout_persistence";
import BorderToggleButton from "../components/border_toggle_button";
import { type LayoutKeys, resetDefaultLayouts } from "./default_layout_configs";
import {
  getMaximizedItemId,
  getBorderOpenStatus,
  adjustModelToBorderOpenStatus,
} from "./flex_layout_helper";

const { Footer } = Layout;
type Model = typeof FlexLayout.Model;
type Action = typeof FlexLayout.Action;
const MIN_BORDER_WIDTH = 300;

type StateProps = {|
  displayScalebars: boolean,
  isUpdateTracingAllowed: boolean,
  datasetName: string,
  organization: string,
  annotationType: AnnotationType,
  name: string,
  taskId: ?string,
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
  borderOpenStatus: BorderOpenStatus = { left: false, right: false };
  maximizedItemId: ?string = null;

  constructor(props: Props) {
    super(props);
    const model = this.getCurrentModel();
    this.unbindListeners = [];
    this.addListeners();
    this.borderOpenStatus = getBorderOpenStatus(model);
    props.setBorderOpenStatus(_.cloneDeep(this.borderOpenStatus));
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

  getCurrentModel() {
    const { layoutName, layoutKey } = this.props;
    const layout = getLayoutConfig(layoutKey, layoutName);
    const model = FlexLayout.Model.fromJson(layout);
    return model;
  }

  updateToModelStateAndAdjustIt(model: Model) {
    this.maximizedItemId = getMaximizedItemId(model);
    adjustModelToBorderOpenStatus(model, this.borderOpenStatus);
    model.setOnAllowDrop(this.allowDrop);
    return model;
  }

  rebuildLayout() {
    const model = this.getCurrentModel();
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

  renderTab(id: string): ?React.Node {
    switch (id) {
      case "DatasetInfoTabView": {
        return <DatasetInfoTabView />;
      }
      case "TreesTabView": {
        return <TreesTabView />;
      }
      case "CommentTabView": {
        return <CommentTabView />;
      }
      case "AbstractTreeTabView": {
        return <AbstractTreeTabView />;
      }
      case "MappingInfoView": {
        return <MappingInfoView />;
      }
      case "MeshesView": {
        return <MeshesView />;
      }
      default: {
        console.error(`The tab with id ${id} is unknown.`);
        return null;
      }
    }
  }

  renderSettingsTab(id: string): ?React.Node {
    switch (id) {
      case "UserSettingsView": {
        return <UserSettingsView />;
      }
      case "DatasetSettingsView": {
        return <DatasetSettingsView />;
      }
      default: {
        console.error(`The settings tab with id ${id} is unknown.`);
        return null;
      }
    }
  }

  renderViewport(id: string): ?React.Node {
    const { displayScalebars, isUpdateTracingAllowed } = this.props;
    switch (id) {
      case OrthoViews.PLANE_XY.id:
      case OrthoViews.PLANE_YZ.id:
      case OrthoViews.PLANE_XZ.id: {
        return <InputCatcher viewportID={id} displayScalebars={displayScalebars} />;
      }
      case OrthoViews.TDView.id: {
        return (
          <InputCatcher viewportID={id} displayScalebars={displayScalebars}>
            <TDViewControls />
          </InputCatcher>
        );
      }
      case ArbitraryViews.arbitraryViewport.id: {
        return (
          <InputCatcher viewportID={ArbitraryViews.arbitraryViewport.id}>
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
        onAction={this.onAction}
        onModelChange={() => this.onLayoutChange()}
      />
    );
  }

  layoutFactory(node: Object): ?React.Node {
    const component = node.getComponent();
    const id = node.getId();
    switch (component) {
      case "tab": {
        return this.renderTab(id);
      }
      case "settings-tab": {
        return this.renderSettingsTab(id);
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
    // If a tab is maximized, this.borderOpenStatus will not change and therefore save the BorderOpenStatus before maximizing.
    Object.entries(this.borderOpenStatus).forEach(([side, isOpen]) => {
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
    if (type === "FlexLayout_AdjustBorderSplit" && data.pos < MIN_BORDER_WIDTH) {
      const side = data.node === "border_left" ? "left" : "right";
      this.toggleBorder(side);
      return undefined;
    }
    return action;
  };

  toggleBorder(side: string, toggleInternalState: boolean = true) {
    this.state.model.doAction(FlexLayout.Actions.selectTab(`${side}-border-tab-container`));
    // The most recent version is of borderOpenStatus is needed as two border toggles might be executed directly after another.
    // If borderOpenStatus was passed via props, the first update  of borderOpenStatus will overwritten by the second update.
    const borderOpenStatusCopy = _.cloneDeep(Store.getState().uiInformation.borderOpenStatus);
    borderOpenStatusCopy[side] = !borderOpenStatusCopy[side];
    this.props.setBorderOpenStatus(borderOpenStatusCopy);
    if (toggleInternalState && this.maximizedItemId == null) {
      // Only adjust the internal state if the toggle is not automated and no tab is maximized.
      this.borderOpenStatus[side] = !this.borderOpenStatus[side];
    }
    this.onLayoutChange();
  }

  render() {
    const { datasetName, organization, annotationType, name, taskId } = this.props;
    const tracingName = name || "[untitled]";
    let footerText = `${datasetName} | ${organization} | `;
    footerText += taskId != null ? `${annotationType} : ${taskId}` : tracingName;

    return (
      <React.Fragment>
        <div className="flex-layout-container">
          <FlexLayout.Layout
            model={this.state.model}
            factory={(...args) => this.layoutFactory(...args)}
            onModelChange={() => this.onLayoutChange()}
            onAction={this.onAction}
          />
        </div>
        <Footer className="footer">
          <BorderToggleButton side="left" onClick={() => this.toggleBorder("left")} small />
          <BorderToggleButton side="right" onClick={() => this.toggleBorder("right")} small />
          {footerText}
        </Footer>
      </React.Fragment>
    );
  }
}

function mapStateToProps(state: OxalisState): StateProps {
  return {
    displayScalebars: state.userConfiguration.displayScalebars,
    isUpdateTracingAllowed: state.tracing.restrictions.allowUpdate,
    datasetName: state.dataset.name,
    organization: state.dataset.owningOrganization,
    annotationType: state.tracing.annotationType,
    name: state.tracing.name,
    taskId: state.task != null ? state.task.id : null,
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
