import React from "react";
import { useSelector } from "react-redux";
import { Tooltip, Menu, MenuItemProps, Alert, ButtonProps, Button } from "antd";
import { LockOutlined } from "@ant-design/icons";
import {
  isFeatureAllowedByPricingPlan,
  PricingPlanEnum,
} from "admin/organization/pricing_plan_utils";
import { isUserAllowedToRequestUpgrades } from "admin/organization/pricing_plan_utils";
import { Link } from "react-router-dom";
import messages from "messages";
import type { MenuClickEventHandler } from "rc-menu/lib/interface";
import type { OxalisState } from "oxalis/store";

const handleMouseClick = (event: React.MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

const handleMenuClick: MenuClickEventHandler = (info) => {
  info.domEvent.preventDefault();
  info.domEvent.stopPropagation();
};

type RequiredPricingProps = { requiredPricingPlan: PricingPlanEnum };

export const PricingEnforcedMenuItem: React.FunctionComponent<
  RequiredPricingProps & MenuItemProps
> = ({ children, requiredPricingPlan, ...menuItemProps }) => {
  const activeOrganization = useSelector((state: OxalisState) => state.activeOrganization);
  const isFeatureAllowed = isFeatureAllowedByPricingPlan(activeOrganization, requiredPricingPlan);

  if (isFeatureAllowed) return <Menu.Item {...menuItemProps}>{children}</Menu.Item>;

  return (
    <Tooltip
      title={messages["organization.plan.feature_not_available"](requiredPricingPlan)}
      placement="right"
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
    </Tooltip>
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
    <Tooltip
      title={messages["organization.plan.feature_not_available"](requiredPricingPlan)}
      placement="right"
    >
      <Button {...buttonProps} disabled>
        {children}
        <LockOutlined style={{ marginLeft: 5 }} />
      </Button>
    </Tooltip>
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
    <Tooltip title={messages["organization.plan.feature_not_available"](requiredPricingPlan)}>
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
            message={messages["organization.plan.feature_not_available"](requiredPricingPlan)}
            icon={<LockOutlined />}
          />
        </div>
      </div>
    </Tooltip>
  );
};

export function PageUnavailableForYourPlanView() {
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const activeOrganization = useSelector((state: OxalisState) => state.activeOrganization);

  const linkToOrganizationSettings =
    activeUser && activeOrganization && isUserAllowedToRequestUpgrades(activeUser) ? (
      <Link to={`/organizations/${activeOrganization.name}`}>Go to Organization Settings</Link>
    ) : null;

  return (
    <div className="container">
      <Alert
        style={{
          maxWidth: "500px",
          margin: "0 auto",
        }}
        message="Feature not available"
        description={
          <>
            <p>
              The requested feature is not available in your WEBKNOSSOS organization. Consider
              upgrading to a higher WEBKNOSSOS plan to unlock it or ask your organization's owner to
              upgrade.
            </p>
            {linkToOrganizationSettings}
          </>
        }
        type="error"
        showIcon
      />
    </div>
  );
}
