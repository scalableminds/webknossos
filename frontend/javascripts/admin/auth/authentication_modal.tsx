import RegistrationFormWKOrg from "admin/auth/registration_form_wkorg";
import { Alert, Modal } from "antd";
import LinkButton from "components/link_button";
import features from "features";
import Toast from "libs/toast";
import messages from "messages";
import type { ComponentType } from "react";
import React, { useState } from "react";
import LoginForm from "./login_form";
import RegistrationFormGeneric from "./registration_form_generic";
type Props = {
  onLoggedIn: (userJustRegistered: boolean) => unknown;
  onCancel: () => void;
  isOpen: boolean;
  alertMessage: string;
  inviteToken?: string;
};
export default function AuthenticationModal({
  onLoggedIn,
  onCancel,
  isOpen,
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

  // RegistrationFormWKOrg always creates a new organization.
  // If an inviteToken exists, a normal RegistrationFormGeneric needs to be used.
  const registrationForm =
    inviteToken == null && features().isWkorgInstance ? (
      <RegistrationFormWKOrg onRegistered={onRegistered} />
    ) : (
      <RegistrationFormGeneric onRegistered={onRegistered} inviteToken={inviteToken} />
    );
  return (
    <Modal title={step} onCancel={onCancel} open={isOpen} footer={null} maskClosable={false}>
      <Alert
        message={alertMessage}
        type="info"
        showIcon
        style={{
          marginBottom: 20,
        }}
      />
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
type AuthenticationProps<R> = R & {
  activeUser: any;
  authenticationMessage: string;
  onClick: (...args: Array<any>) => any;
};
export function withAuthentication<P, C extends ComponentType<P>>(
  WrappedComponent: C,
): ComponentType<AuthenticationProps<P>> {
  return function Wrapper(props: AuthenticationProps<P>) {
    const [isAuthenticationModalOpen, setIsAuthenticationModalOpen] = useState(false);
    const { activeUser, authenticationMessage, onClick: originalOnClick, ...rest } = props;

    if (activeUser != null) {
      // @ts-expect-error ts-migrate(2322) FIXME: Type 'Omit<AuthenticationProps<P>, "activeUser" | ... Remove this comment to see the full error message
      return <WrappedComponent {...rest} onClick={originalOnClick} />;
    } else {
      return (
        <>
          {/* @ts-expect-error ts-migrate(2322) FIXME: Type 'Omit<AuthenticationProps<P>, "activeUser" | ... Remove this comment to see the full error message */}
          <WrappedComponent {...rest} onClick={() => setIsAuthenticationModalOpen(true)} />
          <AuthenticationModal
            alertMessage={authenticationMessage}
            onLoggedIn={() => {
              setIsAuthenticationModalOpen(false);
              originalOnClick();
            }}
            onCancel={() => setIsAuthenticationModalOpen(false)}
            isOpen={isAuthenticationModalOpen}
          />
        </>
      );
    }
  };
}
