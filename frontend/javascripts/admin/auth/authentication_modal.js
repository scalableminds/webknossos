// @flow
import { Modal, Alert } from "antd";
import React, { useState } from "react";

import Toast from "libs/toast";
import messages from "messages";
import features from "features";

import SpotlightRegistrationForm from "dashboard/spotlight_registration_form";
import RegistrationForm from "./registration_form";
import LoginForm from "./login_form";

type Props = {
  onLoggedIn: () => void,
  onCancel: () => void,
  visible: boolean,
};

export default function AuthenticationModal({ onLoggedIn, onCancel, visible }: Props) {
  const [step, setStep] = useState("Register");

  const showLogin = () => setStep("Login");
  const showRegister = () => setStep("Register");
  const onRegistered = (isUserLoggedIn: boolean) => {
    if (isUserLoggedIn) {
      onLoggedIn();
      return;
    }
    Toast.success(messages["auth.account_created"]);
    showLogin();
  };

  const registrationForm = features().isDemoInstance ? (
    <SpotlightRegistrationForm onRegistered={onRegistered} />
  ) : (
    <RegistrationForm onRegistered={onRegistered} />
  );

  return (
    <Modal title={step} onCancel={onCancel} visible={visible} footer={null} maskClosable={false}>
      <Alert
        message="You have to register and/or login to create an annotation."
        type="info"
        showIcon
        style={{ marginBottom: 20 }}
      />
      {step === "Register" ? (
        <React.Fragment>
          {registrationForm}
          <a href="#" onClick={showLogin}>
            Already have an account? Login instead.
          </a>
        </React.Fragment>
      ) : (
        <React.Fragment>
          <LoginForm layout="vertical" onLoggedIn={onLoggedIn} hideFooter />
          <a href="#" onClick={showRegister}>
            Don&apos;t have an account yet? Register here.
          </a>
        </React.Fragment>
      )}
    </Modal>
  );
}
