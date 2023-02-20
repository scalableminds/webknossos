import React from "react";
import { useSelector } from "react-redux";
import { Menu, MenuItemProps, Alert, ButtonProps, Button, Result, Popover } from "antd";
import { LockOutlined } from "@ant-design/icons";
import {
  getFeatureNotAvailableInPlanMessage,
  isFeatureAllowedByPricingPlan,
  PricingPlanEnum,
} from "admin/organization/pricing_plan_utils";
import { isUserAllowedToRequestUpgrades } from "admin/organization/pricing_plan_utils";
import { Link } from "react-router-dom";
import type { MenuClickEventHandler } from "rc-menu/lib/interface";
import type { OxalisState } from "oxalis/store";
import { rgbToHex } from "libs/utils";
import { PRIMARY_COLOR } from "oxalis/constants";
import UpgradePricingPlanModal from "admin/organization/upgrade_plan_modal";
import { APIOrganization, APIUser } from "types/api_flow_types";

const PRIMARY_COLOR_HEX = rgbToHex(PRIMARY_COLOR);

const popOverStyle = { color: "white", maxWidth: 250 };

const handleMouseClick = (event: React.MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

const handleMenuClick: MenuClickEventHandler = (info) => {
  info.domEvent.preventDefault();
  info.domEvent.stopPropagation();
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

export const PricingEnforcedMenuItem: React.FunctionComponent<
  RequiredPricingProps & MenuItemProps
> = ({ children, requiredPricingPlan, ...menuItemProps }) => {
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const activeOrganization = useSelector((state: OxalisState) => state.activeOrganization);
  const isFeatureAllowed = isFeatureAllowedByPricingPlan(activeOrganization, requiredPricingPlan);

  if (isFeatureAllowed) return <Menu.Item {...menuItemProps}>{children}</Menu.Item>;

  return (
    <Popover
      color={PRIMARY_COLOR_HEX}
      content={
        <div style={popOverStyle}>
          {getFeatureNotAvailableInPlanMessage(requiredPricingPlan, activeOrganization, activeUser)}
          {getUpgradeNowButton(activeUser, activeOrganization)}
        </div>
      }
      placement="right"
      trigger="hover"
    >
      <Menu.Item
        onClick={handleMenuClick}
        onAuxClick={handleMouseClick}
        onDoubleClick={handleMouseClick}
        onClickCapture={handleMouseClick}
        className="ant-dropdown-menu-item-disabled"
        {...menuItemProps}
      >
        {children}
        <LockOutlined style={{ marginLeft: 5 }} />
      </Menu.Item>
    </Popover>
  );
};

export const PricingEnforcedMenuItem2: React.FunctionComponent<
  RequiredPricingProps & MenuItemProps
> = ({ children, requiredPricingPlan, ...menuItemProps }) => {
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const activeOrganization = useSelector((state: OxalisState) => state.activeOrganization);
  const isFeatureAllowed = isFeatureAllowedByPricingPlan(activeOrganization, requiredPricingPlan);

  if (isFeatureAllowed) return <>{children}</>;

  return (
    <Popover
      color={PRIMARY_COLOR_HEX}
      content={
        <div style={popOverStyle}>
          {getFeatureNotAvailableInPlanMessage(requiredPricingPlan, activeOrganization, activeUser)}
          {getUpgradeNowButton(activeUser, activeOrganization)}
        </div>
      }
      placement="right"
      trigger="hover"
      zIndex={1500}
    >
      <span
        onClick={handleMenuClick}
        onAuxClick={handleMouseClick}
        onDoubleClick={handleMouseClick}
        onClickCapture={handleMouseClick}
        className="ant-menu-title-content ant-menu-item-disabled"
        {...menuItemProps}
      >
        {children}
        <LockOutlined style={{ marginLeft: 5 }} />
      </span>
    </Popover>
  );
};

export const PricingEnforcedButton: React.FunctionComponent<RequiredPricingProps & ButtonProps> = ({
  children,
  requiredPricingPlan,
  ...buttonProps
}) => {
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const activeOrganization = useSelector((state: OxalisState) => state.activeOrganization);
  const isFeatureAllowed = isFeatureAllowedByPricingPlan(activeOrganization, requiredPricingPlan);

  if (isFeatureAllowed) return <Button {...buttonProps}>{children}</Button>;

  return (
    <Popover
      color={PRIMARY_COLOR_HEX}
      content={
        <div style={popOverStyle}>
          {getFeatureNotAvailableInPlanMessage(requiredPricingPlan, activeOrganization, activeUser)}
          {getUpgradeNowButton(activeUser, activeOrganization)}
        </div>
      }
      placement="bottom"
      trigger="hover"
    >
      <Button {...buttonProps} disabled>
        {children}
        <LockOutlined style={{ marginLeft: 5 }} />
      </Button>
    </Popover>
  );
};

export const PricingEnforcedBlur: React.FunctionComponent<RequiredPricingProps> = ({
  children,
  requiredPricingPlan,
  ...restProps
}) => {
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const activeOrganization = useSelector((state: OxalisState) => state.activeOrganization);
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
    <Popover
      color={PRIMARY_COLOR_HEX}
      content={
        <div style={popOverStyle}>
          {getFeatureNotAvailableInPlanMessage(requiredPricingPlan, activeOrganization, activeUser)}
          {getUpgradeNowButton(activeUser, activeOrganization)}
        </div>
      }
      trigger="hover"
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
    </Popover>
  );
};

export function PageUnavailableForYourPlanView({
  requiredPricingPlan,
}: {
  requiredPricingPlan: PricingPlanEnum;
}) {
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const activeOrganization = useSelector((state: OxalisState) => state.activeOrganization);

  const linkToOrganizationSettings =
    activeUser && activeOrganization && isUserAllowedToRequestUpgrades(activeUser) ? (
      <Link to={`/organizations/${activeOrganization.name}`}>
        <Button>Go to Organization Settings</Button>
      </Link>
    ) : undefined;

  return (
    <div className="container">
      <Result
        status="warning"
        title="Feature not available"
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
          <Link to="/">
            <Button type="primary">Return to Dashboard</Button>
          </Link>,
          linkToOrganizationSettings,
        ]}
      />
    </div>
  );
}
