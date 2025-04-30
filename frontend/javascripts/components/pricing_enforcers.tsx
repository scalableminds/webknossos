import { LockOutlined } from "@ant-design/icons";
import {
  type PricingPlanEnum,
  getFeatureNotAvailableInPlanMessage,
  isFeatureAllowedByPricingPlan,
} from "admin/organization/pricing_plan_utils";
import { isUserAllowedToRequestUpgrades } from "admin/organization/pricing_plan_utils";
import UpgradePricingPlanModal from "admin/organization/upgrade_plan_modal";
import { Alert, Button, type ButtonProps, Col, Popover, Result, Row } from "antd";
import type { PopoverProps } from "antd/lib";
import type { TooltipPlacement } from "antd/lib/tooltip";
import { rgbToHex } from "libs/utils";
import _ from "lodash";
import { PRIMARY_COLOR } from "oxalis/constants";
import type { WebknossosState } from "oxalis/store";
import { SwitchSetting } from "oxalis/view/components/setting_input_views";
import React from "react";
import { useSelector } from "react-redux";
import { Link } from "react-router-dom";
import type { APIOrganization, APIUser } from "types/api_types";

const PRIMARY_COLOR_HEX = rgbToHex(PRIMARY_COLOR);

const popOverStyle = { color: "white", maxWidth: 250 };

const handleMouseClick = (event: React.MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

type RequiredPricingProps = { requiredPricingPlan: PricingPlanEnum };

function getUpgradeNowButton(
  activeUser: APIUser | null | undefined,
  activeOrganization: APIOrganization | null,
) {
  return activeUser && activeOrganization && isUserAllowedToRequestUpgrades(activeUser) ? (
    <div style={{ marginTop: 8 }}>
      <Button
        size="small"
        onClick={() => UpgradePricingPlanModal.upgradePricingPlan(activeOrganization)}
      >
        Upgrade Now
      </Button>
    </div>
  ) : null;
}

const useActiveUserAndOrganization = (): [APIUser | null | undefined, APIOrganization | null] => {
  const activeUser = useSelector((state: WebknossosState) => state.activeUser);
  const activeOrganization = useSelector((state: WebknossosState) => state.activeOrganization);
  return [activeUser, activeOrganization];
};

type PopoverEnforcedProps = RequiredPricingProps &
  PopoverProps & {
    activeUser: APIUser | null | undefined;
    activeOrganization: APIOrganization | null;
    placement?: TooltipPlacement;
    zIndex?: number;
  };
const PricingEnforcedPopover = ({
  children,
  requiredPricingPlan,
  activeUser,
  activeOrganization,
  placement,
  zIndex,
}: React.PropsWithChildren<PopoverEnforcedProps>) => {
  return (
    <Popover
      color={PRIMARY_COLOR_HEX}
      content={
        <div style={popOverStyle}>
          {getFeatureNotAvailableInPlanMessage(requiredPricingPlan, activeOrganization, activeUser)}
          {getUpgradeNowButton(activeUser, activeOrganization)}
        </div>
      }
      placement={placement}
      trigger="hover"
      zIndex={zIndex}
    >
      {children}
    </Popover>
  );
};

export const PricingEnforcedSpan = ({
  children,
  requiredPricingPlan,
}: React.PropsWithChildren<RequiredPricingProps>) => {
  const [activeUser, activeOrganization] = useActiveUserAndOrganization();
  const isFeatureAllowed = isFeatureAllowedByPricingPlan(activeOrganization, requiredPricingPlan);

  if (isFeatureAllowed) return <>{children}</>;

  return (
    <PricingEnforcedPopover
      requiredPricingPlan={requiredPricingPlan}
      activeUser={activeUser}
      activeOrganization={activeOrganization}
      placement="right"
      zIndex={1500}
    >
      <span
        onClick={handleMouseClick}
        onAuxClick={handleMouseClick}
        onDoubleClick={handleMouseClick}
        onClickCapture={handleMouseClick}
        className="ant-menu-title-content ant-menu-item-disabled"
      >
        {children}
        <LockOutlined style={{ marginLeft: 5 }} />
      </span>
    </PricingEnforcedPopover>
  );
};

export const PricingEnforcedButton: React.FunctionComponent<RequiredPricingProps & ButtonProps> = ({
  children,
  requiredPricingPlan,
  ...buttonProps
}) => {
  const [activeUser, activeOrganization] = useActiveUserAndOrganization();
  const isFeatureAllowed = isFeatureAllowedByPricingPlan(activeOrganization, requiredPricingPlan);

  if (isFeatureAllowed) return <Button {...buttonProps}>{children}</Button>;

  return (
    <PricingEnforcedPopover
      requiredPricingPlan={requiredPricingPlan}
      activeUser={activeUser}
      activeOrganization={activeOrganization}
      placement="bottom"
    >
      <Button {...buttonProps} disabled>
        {children}
        <LockOutlined style={{ marginLeft: 5 }} />
      </Button>
    </PricingEnforcedPopover>
  );
};

export const PricingEnforcedSwitchSetting: React.FunctionComponent<
  RequiredPricingProps & {
    label: React.ReactNode;
    onChange: (value: boolean) => void;
    value: boolean;
    defaultValue: boolean;
  }
> = ({ requiredPricingPlan, onChange, value, defaultValue, label }) => {
  const [activeUser, activeOrganization] = useActiveUserAndOrganization();
  const isFeatureAllowed = isFeatureAllowedByPricingPlan(activeOrganization, requiredPricingPlan);

  if (isFeatureAllowed) return <SwitchSetting label={label} value={value} onChange={onChange} />;

  return (
    <PricingEnforcedPopover
      requiredPricingPlan={requiredPricingPlan}
      activeUser={activeUser}
      activeOrganization={activeOrganization}
      placement="top"
    >
      {/* The react element <></> is needed as a wrapper as otherwise
      the PricingEnforcedPopover will not be rendered. */}
      <>
        <SwitchSetting
          label={label}
          value={defaultValue}
          onChange={_.noop}
          disabled
          postSwitchIcon={<LockOutlined style={{ marginLeft: 5 }} />}
        />
      </>
    </PricingEnforcedPopover>
  );
};

export const PricingEnforcedBlur = ({
  children,
  requiredPricingPlan,
  ...restProps
}: React.PropsWithChildren<RequiredPricingProps>) => {
  const [activeUser, activeOrganization] = useActiveUserAndOrganization();
  const isFeatureAllowed = isFeatureAllowedByPricingPlan(activeOrganization, requiredPricingPlan);

  if (isFeatureAllowed)
    // Spread additional props to the children (required since antd's form implementation
    // typically fills value and onChange props on children of FormItems).
    return (
      <>
        {React.Children.map(children, (child) => {
          if (!React.isValidElement(child)) {
            return child;
          }
          return React.cloneElement(child, {
            ...restProps,
          });
        })}
      </>
    );

  return (
    <PricingEnforcedPopover
      requiredPricingPlan={requiredPricingPlan}
      activeUser={activeUser}
      activeOrganization={activeOrganization}
    >
      <div style={{ position: "relative", cursor: "not-allowed" }}>
        <div
          style={{
            filter: "blur(1px)",
            pointerEvents: "none",
          }}
        >
          {children}
        </div>
        <div
          style={{
            position: "absolute",
            left: "calc(50% - 150px)",
            top: "calc(50% - 50px)",
            width: 300,
            maxHeight: 150,
            textAlign: "center",
          }}
        >
          <Alert
            showIcon
            message={getFeatureNotAvailableInPlanMessage(
              requiredPricingPlan,
              activeOrganization,
              activeUser,
            )}
            icon={<LockOutlined />}
          />
        </div>
      </div>
    </PricingEnforcedPopover>
  );
};

export function PageUnavailableForYourPlanView({
  requiredPricingPlan,
}: {
  requiredPricingPlan: PricingPlanEnum;
}) {
  const [activeUser, activeOrganization] = useActiveUserAndOrganization();

  const linkToOrganizationSettings =
    activeUser && activeOrganization && isUserAllowedToRequestUpgrades(activeUser) ? (
      <Link to={`/organizations/${activeOrganization.id}`}>
        <Button>Go to Organization Settings</Button>
      </Link>
    ) : undefined;

  return (
    <Row justify="center" align="middle" className="full-viewport-height">
      <Col>
        <Result
          status="warning"
          title="Feature not available"
          icon={<i className="drawing drawing-paid-feature-not-available" />}
          subTitle={
            <p style={{ maxWidth: "500px", margin: "0 auto" }}>
              {getFeatureNotAvailableInPlanMessage(
                requiredPricingPlan,
                activeOrganization,
                activeUser,
              )}
            </p>
          }
          extra={[
            <Link to="/" key="return-to-dashboard">
              <Button type="primary">Return to Dashboard</Button>
            </Link>,
            linkToOrganizationSettings,
          ]}
        />
      </Col>
    </Row>
  );
}
