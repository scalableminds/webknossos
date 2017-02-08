import React from "react";
import { Tabs } from "antd";
import TracingSettingsView from "./tracing_settings_view";
import UserSettingsView from "./user_settings_view";
import DatasetSettingsView from "./dataset_settings_view";

const TabPane = Tabs.TabPane;

const SettingsView = () =>
  <Tabs defaultActiveKey="1">
    <TabPane tab="Tracing" key="1"><TracingSettingsView /></TabPane>
    <TabPane tab="Dataset" key="2"><DatasetSettingsView /></TabPane>
    <TabPane tab="User" key="3"><UserSettingsView /></TabPane>
  </Tabs>;

export default SettingsView;
