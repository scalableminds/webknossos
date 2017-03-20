/**
 * skeletontracing_right_menu_view.js
 * @flow weak
 */

import AbstractTabView from "oxalis/view/abstract_tab_view";

/**
 * settings_view.js
 * @flow
 */

import React from "react";
import { Tabs } from "antd";
import Store from "oxalis/store";
import type Model from "oxalis/model";
import CommentTabView from "oxalis/view/skeletontracing/right-menu/comment_tab/comment_tab_view";
import AbstractTreeView from "oxalis/view/skeletontracing/right-menu/abstract_tree_view";
import ListTreeView from "oxalis/view/skeletontracing/right-menu/list_tree_view";
import DatasetInfoView from "oxalis/view/viewmode/right-menu/dataset_info_view";

const TabPane = Tabs.TabPane;

type RightMenuViewProps = {
  oldModel: Model,
  isPublicViewMode: boolean,
};

class ReactBackboneWrapper extends React.Component {

  onRefMounted = (domElement) => {
    if (domElement) {
      this.props.backboneView.setElement(domElement);
      this.props.backboneView.render();
    }
  }

  render() {
    return <div ref={this.onRefMounted} />;
  }
}

class RightMenuView extends React.PureComponent {

  props: RightMenuViewProps;
  state: {
    commentTabView: CommentTabView,
    abstractTreeView: AbstractTreeView,
    datasetInfoView: DatasetInfoView,
  };

  componentWillMount() {
    // const commentTabView = new CommentTabView({ model: this.props.oldModel });
    // const abstractTreeView = new AbstractTreeView({ model: this.props.oldModel });
    const datasetInfoView = new DatasetInfoView({ model: this.props.oldModel });

    this.setState({
      // commentTabView,
      // abstractTreeView,
      datasetInfoView,
    });
  }

  render() {

    return (
      <Tabs destroyInactiveTabPane defaultActiveKey="3">
        <TabPane tab="Info" key="1"><ReactBackboneWrapper backboneView={this.state.datasetInfoView} /></TabPane>
        <TabPane tab="Tree Viewer" key="2"></TabPane>
        <TabPane tab="Trees" key="3"><ListTreeView store={Store} /></TabPane>
        <TabPane tab="Comments" key="4"></TabPane>
      </Tabs>
    );
  }
}
export default RightMenuView;
