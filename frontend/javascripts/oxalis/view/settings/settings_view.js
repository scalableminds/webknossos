/**
 * settings_view.js
 * @flow
 */

import { Tabs } from "antd";
import * as React from "react";

import DatasetSettingsView from "oxalis/view/settings/dataset_settings_view";
import UserSettingsView from "oxalis/view/settings/user_settings_view";

const TabPane = Tabs.TabPane;

type Props = {
  dontRenderContents: boolean,
};

const SettingsView = ({ dontRenderContents }: Props) => (
  // Don't render contents to improve performance
  <Tabs destroyInactiveTabPane className="tracing-settings-menu" defaultActiveKey="2">
    <TabPane tab="Tracing" key="1">
      {!dontRenderContents && <UserSettingsView />}
    </TabPane>
    <TabPane tab="Dataset" key="2">
      {!dontRenderContents && <DatasetSettingsView />}
    </TabPane>
  </Tabs>
);

export default SettingsView;
