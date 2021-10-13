// @flow
import { Modal, Alert } from "antd";
import React, { useState, type ComponentType } from "react";

import Toast from "libs/toast";
import messages from "messages";
import features from "features";

import SpotlightRegistrationForm from "admin/auth/spotlight_registration_form";
import LinkButton from "components/link_button";
import RegistrationForm from "./registration_form";
import LoginForm from "./login_form";

type Props = {|
  onLoggedIn: (userJustRegistered: boolean) => mixed,
  onCancel: () => void,
  visible: boolean,
  alertMessage: string,
  inviteToken?: string,
|};

export default function AuthenticationModal({
  onLoggedIn,
  onCancel,
  visible,
  alertMessage,
  inviteToken,
}: Props) {
  const [step, setStep] = useState("Register");

  const showLogin = () => setStep("Login");
  const showRegister = () => setStep("Register");
  const onRegistered = (isUserLoggedIn: boolean) => {
    if (isUserLoggedIn) {
      onLoggedIn(true);
      return;
    }
    Toast.success(messages["auth.account_created"]);
    showLogin();
  };

  // SpotlightRegistrationForm always creates a new organization. If an inviteToken
  // exists, a normal RegistrationForm needs to be used.
  const registrationForm =
    inviteToken == null && features().isDemoInstance ? (
      <SpotlightRegistrationForm onRegistered={onRegistered} />
    ) : (
      <RegistrationForm onRegistered={onRegistered} inviteToken={inviteToken} />
    );

  return (
    <Modal title={step} onCancel={onCancel} visible={visible} footer={null} maskClosable={false}>
      <Alert message={alertMessage} type="info" showIcon style={{ marginBottom: 20 }} />
      {step === "Register" ? (
        <React.Fragment>
          {registrationForm}
          <LinkButton onClick={showLogin}>Already have an account? Login instead.</LinkButton>
        </React.Fragment>
      ) : (
        <React.Fragment>
          <LoginForm layout="vertical" onLoggedIn={() => onLoggedIn(false)} hideFooter />
          <LinkButton onClick={showRegister}>
            Don&apos;t have an account yet? Register here.
          </LinkButton>
        </React.Fragment>
      )}
    </Modal>
  );
}

type AuthenticationProps<R> = {|
  activeUser: any,
  authenticationMessage: string,
  onClick: Function,
  ...R,
|};

export function withAuthentication<P, C: ComponentType<P>>(
  WrappedComponent: C,
): ComponentType<AuthenticationProps<P>> {
  return (props: AuthenticationProps<P>) => {
    const [isAuthenticationModalVisible, setIsAuthenticationModalVisible] = useState(false);
    const { activeUser, authenticationMessage, onClick: originalOnClick, ...rest } = props;
    if (activeUser != null) {
      return <WrappedComponent {...rest} onClick={originalOnClick} />;
    } else {
      return (
        <>
          <WrappedComponent {...rest} onClick={() => setIsAuthenticationModalVisible(true)} />
          <AuthenticationModal
            alertMessage={authenticationMessage}
            onLoggedIn={() => {
              setIsAuthenticationModalVisible(false);
              originalOnClick();
            }}
            onCancel={() => setIsAuthenticationModalVisible(false)}
            visible={isAuthenticationModalVisible}
          />
        </>
      );
    }
  };
}
