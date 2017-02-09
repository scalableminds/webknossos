import React from "react";
import { Tabs } from "antd";
import UserSettingsView from "./user_settings_view";
import DatasetSettingsView from "./dataset_settings_view";

const TabPane = Tabs.TabPane;

const SettingsView = () =>
  <Tabs defaultActiveKey="1">
    <TabPane tab="Tracing" key="1"><UserSettingsView /></TabPane>
    <TabPane tab="Dataset" key="2"><DatasetSettingsView /></TabPane>
  </Tabs>;

export default SettingsView;
