/**
 * settings_view.js
 * @flow
 */

import { Tabs } from "antd";
import * as React from "react";

import DatasetSettingsView from "oxalis/view/settings/dataset_settings_view";
import UserSettingsView from "oxalis/view/settings/user_settings_view";

const TabPane = Tabs.TabPane;

const SettingsView = () => (
  <Tabs destroyInactiveTabPane className="tracing-settings-menu">
    <TabPane tab="Tracing" key="1">
      <UserSettingsView />
    </TabPane>
    <TabPane tab="Dataset" key="2">
      <DatasetSettingsView />
    </TabPane>
  </Tabs>
);

export default SettingsView;
