// @flow
import * as React from "react";
import FlexLayout from "flexlayout-react";
import { connect } from "react-redux";
import type { OxalisState } from "oxalis/store";
import { Icon, Layout, Button } from "antd";
import _ from "lodash";

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

const { Footer } = Layout;

type StateProps = {|
  displayScalebars: boolean,
  isUpdateTracingAllowed: boolean,
|};

type OwnProps = {|
  layout: Object,
  layoutKey: string,
  layoutName: string,
  onLayoutChange: Object => void,
|};

type Props = {| ...OwnProps, ...StateProps |};
type State = {
  model: Object,
};

class FlexLayoutWrapper extends React.PureComponent<Props, State> {
  static getDerivedStateFromProps(props: Props) {
    const { layout } = props;
    const model = FlexLayout.Model.fromJson(layout);
    console.log("got new model");
    return { model };
  }

  constructor(props: Props) {
    super(props);
    const { layout } = props;
    this.state = {
      model: FlexLayout.Model.fromJson(layout),
    };
    this.state.model.setOnAllowDrop(this.allowDrop);
  }

  /* componentDidUpdate(prevProps: Props) {
    const { layoutName, layoutKey } = this.props;
    if (layoutName !== prevProps.layoutName || layoutKey !== prevProps.layoutKey) {
      setTimeout(this.onLayoutChange, 1);
    }
  } */

  allowDrop(dragNode: Object, dropInfo: Object) {
    const dropNode = dropInfo.node;

    // prevent non-border tabs dropping into borders
    if (
      dropNode.getType() === "border" &&
      (dragNode.getParent() == null || dragNode.getParent().getType() !== "border")
    ) {
      console.info("You cannot move this tab into a sidebar!");
      return false;
    }

    // prevent border tabs dropping into main layout
    if (
      dropNode.getType() !== "border" &&
      dragNode.getParent() != null &&
      dragNode.getParent().getType() === "border"
    ) {
      console.info("You cannot move this tab out of this sidebar!");
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
        console.error(`The tab with id ${id} is unknown`);
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
        console.error(`The settings tab with id ${id} is unknown`);
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
        console.error(`The settings tab with id ${id} is unknown`);
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

    return <FlexLayout.Layout model={model} factory={(...args) => this.layoutFactory(...args)} />;
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
    this.props.onLayoutChange(currentLayoutModel);
  };

  toggleSidebar(side: string) {
    this.state.model.doAction(FlexLayout.Actions.selectTab(`${side}-sidebar-tab-container`));
    // Workaround so that onLayoutChange is called after the update of flexlayout.
    // Calling the method without a timeout does not work.
    setTimeout(() => this.onLayoutChange(), 1);
  }

  getSidebarButtons() {
    const SidebarButton = (side: string) => (
      <Button
        className={`${side}-sidebar-button`}
        onClick={() => this.toggleSidebar(side)}
        size="small"
      >
        <Icon
          type={side}
          className="withoutIconMargin"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        />
      </Button>
    );
    return (
      <React.Fragment>
        {SidebarButton("left")}
        {SidebarButton("right")}
      </React.Fragment>
    );
  }

  render() {
    return (
      <React.Fragment>
        <div className="flex-layout-container">
          <FlexLayout.Layout
            model={this.state.model}
            factory={(...args) => this.layoutFactory(...args)}
            onModelChange={() => this.onLayoutChange()}
          />
        </div>
        <Footer className="footer">
          {this.getSidebarButtons()}
          🦶Footer🦶
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

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(FlexLayoutWrapper);
