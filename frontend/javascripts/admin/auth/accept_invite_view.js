// @flow

import { Button, Icon, Result, Layout, Spin } from "antd";
import { AsyncButton } from "components/async_clickables";
import React, { useState } from "react";
import AuthenticationModal from "admin/auth/authentication_modal";
import { useFetch } from "libs/react_helpers";
import { getOrganizationByInvite, joinOrganization } from "admin/admin_rest_api";
import { type APIUser } from "types/api_flow_types";
import Toast from "libs/toast";

const { Content } = Layout;

export default function AcceptInviteView({
  token,
  activeUser,
}: {
  token: string,
  activeUser: ?APIUser,
}) {
  const [isAuthenticationModalVisible, setIsAuthenticationModalVisible] = useState(false);
  const [targetOrganization, exception] = useFetch(
    async () => {
      try {
        return [await getOrganizationByInvite(token), null];
      } catch (exc) {
        return [null, exc];
      }
    },
    [null, null],
    [token],
  );

  if (exception != null) {
    return (
      <Result
        status="warning"
        title={<div>An error occurred. The link you clicked might have expired.</div>}
      />
    );
  }
  const targetOrganizationName =
    targetOrganization != null ? targetOrganization.displayName : "unknown";

  const onSuccessfulJoin = () => {
    Toast.success(`You successfully joined ${targetOrganizationName}`);
  };
  const onClickJoin = async () => {
    await joinOrganization(token);
    onSuccessfulJoin();
  };

  const authenticateMessage =
    activeUser != null ? null : "Please log in or register to join this organization.";

  const primaryButton =
    activeUser != null ? (
      <AsyncButton type="primary" onClick={onClickJoin}>
        Join this Organization
      </AsyncButton>
    ) : (
      <div>
        <Button onClick={() => setIsAuthenticationModalVisible(true)}>Log in</Button>
        <Button onClick={() => setIsAuthenticationModalVisible(true)}>Register</Button>
      </div>
    );

  return (
    <Content className="centered-content" style={{ padding: "0 50px", marginTop: 64 }}>
      <AuthenticationModal
        alertMessage={`Please register or login to join ${targetOrganizationName}.`}
        inviteToken={token}
        onLoggedIn={async userJustRegistered => {
          setIsAuthenticationModalVisible(false);
          if (!userJustRegistered) {
            await onClickJoin();
          } else {
            // The user already joined the organization when they registered. Just
            // notify them.
            onSuccessfulJoin();
          }
        }}
        onCancel={() => setIsAuthenticationModalVisible(false)}
        visible={isAuthenticationModalVisible}
      />
      <Spin spinning={targetOrganization == null}>
        <Result
          icon={<Icon type="gift" theme="twoTone" />}
          title={
            <div>
              You have been invited to the organization &ldquo;
              {targetOrganizationName}&rdquo;!
              {authenticateMessage}
            </div>
          }
          extra={primaryButton}
        />
      </Spin>
    </Content>
  );
}
