import RegistrationFormGeneric from "admin/auth/registration_form_generic";
import RegistrationFormWKOrg from "admin/auth/registration_form_wkorg";
import { getDefaultOrganization } from "admin/rest_api";
import { Card, Col, Row, Spin } from "antd";
import features from "features";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import messages from "messages";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import type { APIOrganization } from "types/api_types";

function RegistrationViewGeneric() {
  const navigate = useNavigate();
  const [organization, setOrganization] = useState<APIOrganization | null>(null);
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
    content = (
      <Card
        style={{
          marginBottom: 24,
        }}
      >
        Loading...
      </Card>
    );
  } else if (organization != null) {
    content = (
      <>
        <Card
          style={{
            marginBottom: 24,
          }}
        >
          You are about to join the organization &ldquo;{organization.name}&rdquo;!
        </Card>
        <RegistrationFormGeneric // The key is used to enforce a remount in case the organizationId changes.
          // That way, we ensure that the organization field is cleared.
          key={organization.id}
          targetOrganization={organization}
          onRegistered={(isUserLoggedIn?: boolean) => {
            if (isUserLoggedIn) {
              navigate(-1);
            } else {
              Toast.success(messages["auth.account_created"]);
              navigate("/auth/login");
            }
          }}
        />
      </>
    );
  } else {
    content = (
      <Card
        style={{
          marginBottom: 24,
        }}
      >
        We could not find a default organization to sign up for.
        <br /> Please check your link or contact{" "}
        <a href="mailto:hello@webknossos.org">hello@webknossos.org</a> for help on setting up
        webKnossos.
      </Card>
    );
  }

  return (
    <Spin spinning={isLoading}>
      <Row justify="center" align="middle" className="login-view">
        <Col>
          <Card className="login-content drawing-signup" style={{ maxWidth: 1000 }}>
            <h3>Sign Up</h3>
            {content}
            <Link to="/auth/login">Already have an account? Login instead.</Link>
          </Card>
        </Col>
      </Row>
    </Spin>
  );
}

function RegistrationViewWkOrg() {
  const navigate = useNavigate();
  return (
    <Row justify="center" align="middle" className="login-view">
      <Col>
        <Card className="login-content drawing-signup" style={{ maxWidth: 1000 }}>
          <h3>Sign Up</h3>
          <RegistrationFormWKOrg
            onRegistered={() => {
              navigate("/dashboard");
            }}
          />
          <p
            style={{
              textAlign: "center",
            }}
          >
            <Link to="/auth/login">Log in to existing account</Link>
          </p>
        </Card>
      </Col>
    </Row>
  );
}

function RegistrationView() {
  // If you're already logged in, redirect to the dashboard
  const isAuthenticated = useWkSelector((state) => state.activeUser != null);

  if (isAuthenticated) {
    return <Navigate to="/" />;
  }
  return features().isWkorgInstance ? <RegistrationViewWkOrg /> : <RegistrationViewGeneric />;
}

export default RegistrationView;
