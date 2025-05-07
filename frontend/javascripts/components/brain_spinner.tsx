import LoginForm from "admin/auth/login_form";
import { switchToOrganization } from "admin/rest_api";
import { Button, Card, Col, Row } from "antd";
import { AsyncButton } from "components/async_clickables";
import messages from "messages";
import type * as React from "react";
import { Link } from "react-router-dom";
import type { APIOrganization } from "types/api_types";

type Props = {
  message?: React.ReactNode;
  isLoading?: boolean;
};
export default function BrainSpinner({ message, isLoading = true }: Props) {
  return (
    <div className="brain-loading">
      <div className="brain-loading-container">
        <div className="brain-loading-content">
          <img
            src="/assets/images/brain.svg"
            alt=""
            style={{
              width: "100%",
              height: "100%",
              marginLeft: "auto",
              marginRight: "auto",
              marginTop: "10%",
            }}
          />
          {isLoading ? (
            <div
              className="brain-loading-bar"
              style={{
                width: "80%",
                marginLeft: "auto",
                marginRight: "auto",
                marginTop: 30,
              }}
            />
          ) : null}
          {message}
        </div>
      </div>
    </div>
  );
}

export function BrainSpinnerWithError({
  gotUnhandledError,
  organizationToSwitchTo,
  entity = "dataset",
}: {
  gotUnhandledError: boolean;
  organizationToSwitchTo: APIOrganization | null | undefined;
  entity?: "dataset" | "workflow";
}) {
  const switchToOwningOrganizationButton = (
    <AsyncButton
      type="primary"
      onClick={async () => {
        if (organizationToSwitchTo != null) {
          await switchToOrganization(organizationToSwitchTo.id);
        }
      }}
    >
      Switch to this Organization
    </AsyncButton>
  );

  const message =
    organizationToSwitchTo != null
      ? `This ${entity} belongs to the organization ${organizationToSwitchTo.name} which is currently not your active organization. Do you want to switch to that organization?`
      : `Either the ${entity} does not exist or you do not have the necessary access rights.`;
  return (
    <BrainSpinner
      message={
        <>
          <div style={{ textAlign: "center" }}>
            {gotUnhandledError ? messages["tracing.unhandled_initialization_error"] : message}
          </div>
          <div className="flex-center-child" style={{ gap: 8 }}>
            {organizationToSwitchTo != null ? <div>{switchToOwningOrganizationButton}</div> : null}
            <div>
              <Link
                to="/"
                style={{
                  marginTop: 16,
                }}
              >
                <Button type="primary">Return to dashboard</Button>
              </Link>
            </div>
          </div>
        </>
      }
      isLoading={false}
    />
  );
}

export function CoverWithLogin({ onLoggedIn }: { onLoggedIn: () => void }) {
  return (
    <Row justify="center" align="middle" className="login-view">
      <Col xs={22} sm={20} md={16} lg={12} xl={8}>
        <Card className="login-content">
          <h3>Try logging in to view the dataset.</h3>
          <LoginForm layout="horizontal" onLoggedIn={onLoggedIn} />
        </Card>
      </Col>
    </Row>
  );
}
