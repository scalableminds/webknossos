// @flow
import React, { useEffect, useState } from "react";
import { Link, useHistory } from "react-router-dom";
import { Spin, Row, Col, Card } from "antd";
import messages from "messages";
import Toast from "libs/toast";
import { getOrganization, getDefaultOrganization } from "admin/admin_rest_api";
import features from "features";
import RegistrationForm from "./registration_form";

type Props = {
  organizationName?: string,
};

function RegistrationView({ organizationName }: Props) {
  const history = useHistory();
  const [organization, setOrganization] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      try {
        if (organizationName != null) {
          setOrganization(await getOrganization(organizationName));
        } else {
          const defaultOrg = await getDefaultOrganization();
          setOrganization(defaultOrg);
        }
      } finally {
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
        {organizationName != null
          ? "We could not find your organization."
          : "We could not find a default organization to sign up for."}
        <br /> Please check your link or{" "}
        {features().isDemoInstance ? (
          <>
            <Link to="/">create a new organization</Link>.
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
