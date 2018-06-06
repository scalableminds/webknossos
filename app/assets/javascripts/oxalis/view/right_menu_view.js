/**
 * right_menu_view.js
 * @flow
 */

import * as React from "react";
import { Tabs } from "antd";
import CommentTabView from "oxalis/view/right-menu/comment_tab/comment_tab_view";
import AbstractTreeTabView from "oxalis/view/right-menu/abstract_tree_tab_view";
import TreesTabView from "oxalis/view/right-menu/trees_tab_view";
import DatasetInfoTabView from "oxalis/view/right-menu/dataset_info_tab_view";
import MappingInfoView from "oxalis/view/right-menu/mapping_info_view";
import type { ControlModeType, ModeType } from "oxalis/constants";
import Constants, { ControlModeEnum } from "oxalis/constants";
import type { OxalisState } from "oxalis/store";
import { connect } from "react-redux";
import Model from "oxalis/model";

const TabPane = Tabs.TabPane;

type Props = {
  controlMode: ControlModeType,
  viewMode: ModeType,
};

class RightMenuView extends React.Component<Props> {
  getTabs() {
    const tabs = [];
    if (this.props.controlMode !== ControlModeEnum.VIEW) {
      if (Constants.MODES_SKELETON.includes(this.props.viewMode)) {
        tabs.push(
          <TabPane tab="Trees" key="3" className="flex-column">
            <TreesTabView />
          </TabPane>,
          <TabPane tab="Comments" key="4" className="flex-column">
            <CommentTabView />
          </TabPane>,
          <TabPane tab="Tree Viewer" key="2" className="flex-column">
            <AbstractTreeTabView />
          </TabPane>,
        );
      }
    }

    const hasSegmentation = Model.getSegmentationLayer() != null;
    if (hasSegmentation) {
      tabs.push(
        <TabPane tab="Segmentation" key="5" className="flex-column">
          <MappingInfoView />
        </TabPane>,
      );
    }

    return tabs;
  }

  render() {
    return (
      <Tabs
        destroyInactiveTabPane
        defaultActiveKey="1"
        className="tracing-right-menu flex-column flex-column-for-ant-tabs-container"
      >
        <TabPane tab="Info" key="1" className="flex-column">
          <DatasetInfoTabView />
        </TabPane>
        {this.getTabs()}
      </Tabs>
    );
  }
}

function mapStateToProps(state: OxalisState): Props {
  return {
    controlMode: state.temporaryConfiguration.controlMode,
    viewMode: state.temporaryConfiguration.viewMode,
  };
}

export default connect(mapStateToProps, null, null, { pure: false })(RightMenuView);
