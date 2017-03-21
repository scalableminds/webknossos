/**
 * right_menu_view.js
 * @flow
 */

import React from "react";
import { Tabs } from "antd";
import type Model from "oxalis/model";
import CommentTabView from "oxalis/view/skeletontracing/right-menu/comment_tab/comment_tab_view";
import AbstractTreeTabView from "oxalis/view/skeletontracing/right-menu/abstract_tree_tab_view";
import TreesTabView from "oxalis/view/skeletontracing/right-menu/trees_tab_view";
import DatasetInfoTabView from "oxalis/view/viewmode/right-menu/dataset_info_tab_view";
import MappingInfoView from "oxalis/view/volumetracing/right-menu/mapping_info_view";

const TabPane = Tabs.TabPane;

type RightMenuViewProps = {
  oldModel: Model,
};

export default function RightMenuView({ oldModel }: RightMenuViewProps) {
  return (
    <Tabs destroyInactiveTabPane defaultActiveKey="1">
      <TabPane tab="Info" key="1"><DatasetInfoTabView oldModel={oldModel} /></TabPane>
      <TabPane tab="Tree Viewer" key="2"><AbstractTreeTabView /></TabPane>
      <TabPane tab="Trees" key="3"><TreesTabView /></TabPane>
      <TabPane tab="Comments" key="4"><CommentTabView /></TabPane>
      <TabPane tab="Mappings" key="5"><MappingInfoView oldModel={oldModel} /></TabPane>
    </Tabs>
  );
}
