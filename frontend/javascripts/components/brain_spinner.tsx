import * as React from "react";
import { APIOrganization } from "types/api_flow_types";
import { AsyncButton } from "components/async_clickables";
import { switchToOrganization } from "admin/admin_rest_api";
import messages from "messages";
import { Link } from "react-router-dom";
import { Button, Col, Row } from "antd";
import LoginForm from "admin/auth/login_form";

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
          await switchToOrganization(organizationToSwitchTo.name);
        }
      }}
    >
      Switch to this Organization
    </AsyncButton>
  );

  const message =
    organizationToSwitchTo != null
      ? `This ${entity} belongs to the organization ${organizationToSwitchTo.displayName} which is currently not your active organization. Do you want to switch to that organization?`
      : `Either the ${entity} does not exist or you do not have the necessary access rights.`;
  return (
    <BrainSpinner
      message={
        <>
          <div style={{ textAlign: "center" }}>
            {gotUnhandledError ? messages["tracing.unhandled_initialization_error"] : message}
          </div>
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
        </>
      }
      isLoading={false}
    />
  );
}

export function CoverWithLogin({ onLoggedIn }: { onLoggedIn: () => void }) {
  return (
    <div className="cover-whole-screen">
      <Row
        justify="center"
        style={{
          padding: 50,
        }}
        align="middle"
      >
        <Col xs={22} sm={20} md={16} lg={12} xl={8}>
          <span style={{ margin: "0 auto", display: "table" }}>
            <h3>Try logging in to view the dataset.</h3>
            <LoginForm layout="horizontal" onLoggedIn={onLoggedIn} />
          </span>
        </Col>
      </Row>
    </div>
  );
}
