/**
 * settings_view.js
 * @flow
 */

import React from "react";
import { Tabs } from "antd";
import UserSettingsView from "oxalis/view/settings/user_settings_view";
import DatasetSettingsView from "oxalis/view/settings/dataset_settings_view";

const TabPane = Tabs.TabPane;

const SettingsView = ({ isPublicViewMode }:{isPublicViewMode: boolean}) =>
  <Tabs destroyInactiveTabPane>
    <TabPane tab="Tracing" key="1"><UserSettingsView isPublicViewMode={isPublicViewMode} /></TabPane>
    <TabPane tab="Dataset" key="2"><DatasetSettingsView /></TabPane>
  </Tabs>;

export default SettingsView;
