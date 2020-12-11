// @flow

import {
  Result,
  Layout,
  Form,
  Popover,
  Modal,
  Input,
  Button,
  Row,
  Col,
  Steps,
  Icon,
  Card,
  AutoComplete,
  Alert,
  Spin,
} from "antd";
import { AsyncButton } from "components/async_clickables";
import { type RouterHistory, Link, withRouter } from "react-router-dom";
import { connect } from "react-redux";
import Clipboard from "clipboard-js";
import React, { type Node } from "react";
import { useFetch } from "libs/react_helpers";
import { getOrganizationByInvite, joinOrganization } from "admin/admin_rest_api";

const { Header, Content, Footer, Sider } = Layout;

export default function AcceptInviteView({ token }) {
  const targetOrganization = useFetch(() => getOrganizationByInvite(token), null, [token]);

  const onClickJoin = () => joinOrganization(token);

  return (
    <Content className="centered-content" style={{ padding: "0 50px", marginTop: 64 }}>
      <Spin spinning={targetOrganization == null}>
        <Result
          icon={<Icon type="gift" theme="twoTone" />}
          title={
            <div>
              You have been invited to the organization &ldquo;
              {targetOrganization != null ? targetOrganization.displayName : null}&rdquo;!
            </div>
          }
          extra={
            <AsyncButton type="primary" onClick={onClickJoin}>
              Join this Organization
            </AsyncButton>
          }
        />
      </Spin>
    </Content>
  );
}
