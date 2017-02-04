import React from "react";
import { Tabs } from "antd";
import TracingSettingsView from "./tracing_settings_view";

const TabPane = Tabs.TabPane;

const SettingsView = () =>
  <Tabs defaultActiveKey="1">
    <TabPane tab="Tracing" key="1"><TracingSettingsView /></TabPane>
    <TabPane tab="Dataset" key="2"></TabPane>
    <TabPane tab="User" key="3"></TabPane>
  </Tabs>;

export default SettingsView;
