/**
 * right_menu_view.js
 * @flow
 */

import React from "react";
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

const TabPane = Tabs.TabPane;

type Props = {
  controlMode: ControlModeType,
  viewMode: ModeType,
};

class RightMenuView extends React.PureComponent {
  props: Props;

  getTabs() {
    if (this.props.controlMode !== ControlModeEnum.VIEW) {
      if (Constants.MODES_SKELETON.includes(this.props.viewMode)) {
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
      <Tabs destroyInactiveTabPane defaultActiveKey="1" className="tracing-right-menu flex-column flex-column-for-ant-tabs-container">
        <TabPane tab="Info" key="1"><DatasetInfoTabView /></TabPane>
        { this.getTabs() }
      </Tabs>
    );
  }
}

function mapStateToProps(state: OxalisState) {
  return {
    controlMode: state.temporaryConfiguration.controlMode,
    viewMode: state.temporaryConfiguration.viewMode,
  };
}

export default connect(mapStateToProps)(RightMenuView);
