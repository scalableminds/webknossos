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
              width: 375,
              height: 299,
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
          {message != null ? (
            <div
              style={{
                marginLeft: "auto",
                marginRight: "auto",
                marginTop: 30,
              }}
            >
              {message}
            </div>
          ) : null}
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
      style={{
        marginRight: 26,
      }}
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
        <div
          style={{
            textAlign: "center",
          }}
        >
          {gotUnhandledError ? messages["tracing.unhandled_initialization_error"] : message}
          <br />
          <div
            style={{
              marginTop: 16,
              display: "inline-block",
            }}
          >
            {organizationToSwitchTo != null ? switchToOwningOrganizationButton : null}
            <Link to="/">
              <Button type="primary">Return to dashboard</Button>
            </Link>
          </div>
        </div>
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
        <Col span={8}>
          <h3>Try logging in to view the dataset.</h3>
          <LoginForm layout="horizontal" onLoggedIn={onLoggedIn} />
        </Col>
      </Row>
    </div>
  );
}
