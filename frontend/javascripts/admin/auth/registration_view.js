// @flow
import React, { useEffect, useState } from "react";
import { Link, useHistory } from "react-router-dom";
import { Spin, Row, Col, Card } from "antd";
import messages from "messages";
import Toast from "libs/toast";
import { getOrganization } from "admin/admin_rest_api";
import features from "features";
import RegistrationForm from "./registration_form";

type Props = {
  organizationName: string,
};

function RegistrationView({ organizationName = "default" }: Props) {
  const history = useHistory();
  const [organization, setOrganization] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (organizationName) {
        try {
          setIsLoading(true);
          setOrganization(await getOrganization(organizationName));
        } finally {
          setIsLoading(false);
        }
      } else {
        setOrganization(null);
        setIsLoading(false);
      }
    })();
  }, [organizationName]);

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
          key={organizationName}
          organizationName={organizationName}
          onRegistered={(isUserLoggedIn?: boolean) => {
            if (isUserLoggedIn) {
              history.goBack();
            } else {
              Toast.success(messages["auth.account_created"]);
              history.push("/auth/login");
            }
          }}
          onOrganizationNameNotFound={() => {
            Toast.error(messages["auth.invalid_organization_name"]);
            history.push("/auth/register");
          }}
        />
      </>
    );
  } else {
    content = (
      <Card style={{ marginBottom: 24 }}>
        We could not find your organization.
        <br /> Please check your link or{" "}
        {features().isDemoInstance ? (
          <>
            <Link to="/onboarding">create a new organization</Link>.
          </>
        ) : (
          <>
            contact <a href="mailto:hello@scalableminds.com">hello@scalableminds.com</a> for help on
            setting up webKnossos.
          </>
        )}
      </Card>
    );
  }

  return (
    <Spin spinning={isLoading}>
      <Row type="flex" justify="center" style={{ padding: 50 }} align="middle">
        <Col span={8}>
          <h3>Registration</h3>
          {content}
          <Link to="/auth/login">Already have an account? Login instead.</Link>
        </Col>
      </Row>
    </Spin>
  );
}

export default RegistrationView;
