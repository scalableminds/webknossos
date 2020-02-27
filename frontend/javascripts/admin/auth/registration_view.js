// @flow
import React, { useEffect, useState, useMemo } from "react";
import { Link, useHistory } from "react-router-dom";
import { Row, Col, Card } from "antd";
import messages from "messages";
import Toast from "libs/toast";
import { getOrganizations } from "admin/admin_rest_api";
import features from "features";
import RegistrationForm from "./registration_form";

type Props = {
  organizationName: ?string,
};

function RegistrationView({ organizationName }: Props) {
  const history = useHistory();
  const [allOrganizations, setAllOrganizations] = useState([]);

  useEffect(() => {
    (async () => {
      const organizations = await getOrganizations();
      setAllOrganizations(organizations);
    })();
  }, []);

  const organizationDisplayName = useMemo(() => {
    if (organizationName == null) {
      return null;
    }
    const organization = allOrganizations.find(o => o.name === organizationName);
    return organization != null ? organization.displayName : organizationName;
  }, [allOrganizations, organizationName]);

  const greetingCard =
    organizationDisplayName != null ? (
      <Card style={{ marginBottom: 24 }}>
        You are about to join the organization &ldquo;{organizationDisplayName}&rdquo;!
      </Card>
    ) : (
      <Card style={{ marginBottom: 24 }}>
        Not a member of the listed organizations?
        <br />
        {features().isDemoInstance ? (
          <Link to="/onboarding">Create a new organization.</Link>
        ) : (
          <React.Fragment>
            Contact <a href="mailto:hello@scalableminds.com">hello@scalableminds.com</a> for help on
            setting up webKnossos.
          </React.Fragment>
        )}
      </Card>
    );

  return (
    <Row type="flex" justify="center" style={{ padding: 50 }} align="middle">
      <Col span={8}>
        <h3>Registration</h3>
        {greetingCard}
        <RegistrationForm
          // The key is used to enforce a remount in case the organizationName changes.
          // That way, we ensure that the organization field is cleared.
          key={organizationName || "default registration form key"}
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
        <Link to="/auth/login">Already have an account? Login instead.</Link>
      </Col>
    </Row>
  );
}

export default RegistrationView;
