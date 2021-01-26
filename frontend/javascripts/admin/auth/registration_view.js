// @flow
import React, { useEffect, useState } from "react";
import { Link, useHistory } from "react-router-dom";
import { Spin, Row, Col, Card } from "antd";
import messages from "messages";
import Toast from "libs/toast";
import { getDefaultOrganization } from "admin/admin_rest_api";
import features from "features";
import SpotlightRegistrationForm from "admin/auth/spotlight_registration_form";
import RegistrationForm from "admin/auth/registration_form";

function RegistrationViewNotDemo() {
  const history = useHistory();
  const [organization, setOrganization] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      try {
        const defaultOrg = await getDefaultOrganization();
        setOrganization(defaultOrg);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  let content = null;
  if (isLoading) {
    content = <Card style={{ marginBottom: 24 }}>Loading...</Card>;
  } else if (organization != null) {
    content = (
      <>
        <Card style={{ marginBottom: 24 }}>
          You are about to join the organization &ldquo;{organization.displayName}&rdquo;!
        </Card>
        <RegistrationForm
          // The key is used to enforce a remount in case the organizationName changes.
          // That way, we ensure that the organization field is cleared.
          key={organization.name}
          targetOrganization={organization}
          onRegistered={(isUserLoggedIn?: boolean) => {
            if (isUserLoggedIn) {
              history.goBack();
            } else {
              Toast.success(messages["auth.account_created"]);
              history.push("/auth/login");
            }
          }}
        />
      </>
    );
  } else {
    content = (
      <Card style={{ marginBottom: 24 }}>
        We could not find a default organization to sign up for.
        <br /> Please check your link or contact{" "}
        <a href="mailto:hello@scalableminds.com">hello@scalableminds.com</a> for help on setting up
        webKnossos.
      </Card>
    );
  }

  return (
    <Spin spinning={isLoading}>
      <Row type="flex" justify="center" style={{ padding: 50 }} align="middle">
        <Col span={8}>
          <h3>Sign Up</h3>
          {content}
          <Link to="/auth/login">Already have an account? Login instead.</Link>
        </Col>
      </Row>
    </Spin>
  );
}

function RegistrationViewDemo() {
  return (
    <Row type="flex" justify="center" style={{ padding: 50 }} align="middle">
      <Col span={8}>
        <div>
          <h3>Sign Up</h3>
          <SpotlightRegistrationForm
            onRegistered={() => {
              history.push("/dashboard?showWhatsNextBanner");
            }}
          />
          <p style={{ textAlign: "center" }}>
            <Link to="/auth/login">Log in to existing account</Link>
          </p>
        </div>
      </Col>
    </Row>
  );
}

function RegistrationView() {
  return features().isDemoInstance ? <RegistrationViewDemo /> : <RegistrationViewNotDemo />;
}

export default RegistrationView;
