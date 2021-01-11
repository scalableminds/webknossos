// @flow

import { Button, Icon, Result, Layout, Spin } from "antd";
import { useHistory } from "react-router-dom";
import { AsyncButton } from "components/async_clickables";
import React, { useState } from "react";
import AuthenticationModal from "admin/auth/authentication_modal";
import { useFetch } from "libs/react_helpers";
import {
  getOrganizationByInvite,
  joinOrganization,
  switchToOrganization,
} from "admin/admin_rest_api";
import { type APIUser } from "types/api_flow_types";
import Toast from "libs/toast";
import { location } from "libs/window";

const { Content } = Layout;

export default function AcceptInviteView({
  token,
  activeUser,
}: {
  token: string,
  activeUser: ?APIUser,
}) {
  const history = useHistory();
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
    targetOrganization != null
      ? targetOrganization.displayName || targetOrganization.name
      : "unknown";

  const onSuccessfulJoin = (userJustRegistered?: boolean = false) => {
    history.push("/dashboard");
    if (userJustRegistered) {
      // Since the user just registered, the organization is already active.
      Toast.success(`You successfully joined ${targetOrganizationName}.`);
      location.reload();
    } else {
      Toast.success(`You successfully joined ${targetOrganizationName}. Switching to it now...`);
      if (targetOrganization) {
        switchToOrganization(targetOrganization.name);
      }
    }
  };
  const onClickJoin = async () => {
    await joinOrganization(token);
    onSuccessfulJoin();
  };

  const authenticateMessage =
    activeUser != null ? null : <p>Please log in or register to join this organization.</p>;

  const primaryButton =
    activeUser != null ? (
      <AsyncButton type="primary" onClick={onClickJoin} size="large">
        Join this Organization
      </AsyncButton>
    ) : (
      <Button type="primary" onClick={() => setIsAuthenticationModalVisible(true)} size="large">
        Log in / Register
      </Button>
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
            // The user already joined the organization when they registered. All that is
            // left to do is to notify them and reload the page.
            onSuccessfulJoin(userJustRegistered);
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
              You have been invited to the organization &ldquo;{targetOrganizationName}&rdquo;!
              {authenticateMessage}
            </div>
          }
          extra={primaryButton}
        />
      </Spin>
    </Content>
  );
}
