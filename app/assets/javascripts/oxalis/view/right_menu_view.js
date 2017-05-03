/**
 * right_menu_view.js
 * @flow
 */

import React from "react";
import { Tabs } from "antd";
import Model from "oxalis/model";
import CommentTabView from "oxalis/view/right-menu/comment_tab/comment_tab_view";
import AbstractTreeTabView from "oxalis/view/right-menu/abstract_tree_tab_view";
import TreesTabView from "oxalis/view/right-menu/trees_tab_view";
import DatasetInfoTabView from "oxalis/view/right-menu/dataset_info_tab_view";
import MappingInfoView from "oxalis/view/right-menu/mapping_info_view";
import Constants from "oxalis/constants";
import Store from "oxalis/store";

const TabPane = Tabs.TabPane;

class RightMenuView extends React.PureComponent {

  getTabs() {
    if (!Model.controlMode !== Constants.CONTROL_MODE_VIEW) {
      if (Store.getState().viewMode in Constants.MODES_SKELETON) {
        return [
          <TabPane tab="Trees" key="3" className="flex-column"><TreesTabView /></TabPane>,
          <TabPane tab="Comments" key="4" className="flex-column"><CommentTabView /></TabPane>,
          <TabPane tab="Tree Viewer" key="2" className="flex-column"><AbstractTreeTabView /></TabPane>,
        ];
      } else {
        return <TabPane tab="Mappings" key="5"><MappingInfoView /></TabPane>;
      }
    }

    return null;
  }

  render() {
    return (
      <Tabs destroyInactiveTabPane defaultActiveKey="1" className="flex-column flex-column-for-ant-tabs-container">
        <TabPane tab="Info" key="1"><DatasetInfoTabView /></TabPane>
        { this.getTabs() }
      </Tabs>
    );
  }
}

export default RightMenuView;
