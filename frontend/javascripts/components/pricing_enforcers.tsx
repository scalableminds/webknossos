import React from "react";
import { useSelector } from "react-redux";
import { Menu, MenuItemProps, Alert, ButtonProps, Button, Result, Popover } from "antd";
import { LockOutlined } from "@ant-design/icons";
import {
  getFeatureNotAvailabeInPlanMessage,
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

function getUpgradeNowButton() {
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const activeOrganization = useSelector((state: OxalisState) => state.activeOrganization);

  return activeUser && activeOrganization && isUserAllowedToRequestUpgrades(activeUser) ? (
    <Button
      size="small"
      onClick={() => UpgradePricingPlanModal.upgradePricingPlan(activeOrganization)}
      style={{ marginTop: 10 }}
    >
      Upgrade Now
    </Button>
  ) : null;
}

export const PricingEnforcedMenuItem: React.FunctionComponent<
  RequiredPricingProps & MenuItemProps
> = ({ children, requiredPricingPlan, ...menuItemProps }) => {
  const activeOrganization = useSelector((state: OxalisState) => state.activeOrganization);
  const isFeatureAllowed = isFeatureAllowedByPricingPlan(activeOrganization, requiredPricingPlan);

  if (isFeatureAllowed) return <Menu.Item {...menuItemProps}>{children}</Menu.Item>;

  return (
    <Popover
      color={PRIMARY_COLOR_HEX}
      content={
        <div style={popOverStyle}>
          {getFeatureNotAvailabeInPlanMessage(requiredPricingPlan, activeOrganization)}
          {getUpgradeNowButton()}
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

export const PricingEnforcedButton: React.FunctionComponent<RequiredPricingProps & ButtonProps> = ({
  children,
  requiredPricingPlan,
  ...buttonProps
}) => {
  const activeOrganization = useSelector((state: OxalisState) => state.activeOrganization);
  const isFeatureAllowed = isFeatureAllowedByPricingPlan(activeOrganization, requiredPricingPlan);

  if (isFeatureAllowed) return <Button {...buttonProps}>{children}</Button>;

  return (
    <Popover
      color={PRIMARY_COLOR_HEX}
      content={
        <div style={popOverStyle}>
          {getFeatureNotAvailabeInPlanMessage(requiredPricingPlan, activeOrganization)}
          {getUpgradeNowButton()}
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
          {getFeatureNotAvailabeInPlanMessage(requiredPricingPlan, activeOrganization)}
          {getUpgradeNowButton()}
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
            message={getFeatureNotAvailabeInPlanMessage(requiredPricingPlan, activeOrganization)}
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
            {getFeatureNotAvailabeInPlanMessage(requiredPricingPlan, activeOrganization)}
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

// style={{
//           maxWidth: "500px",
//           margin: "0 auto",
//         }}
