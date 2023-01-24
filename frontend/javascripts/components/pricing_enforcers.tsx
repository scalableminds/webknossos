import React from "react";
import { useSelector } from "react-redux";
import { Tooltip, Menu, MenuItemProps, Alert, ButtonProps, Button } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { PricingPlanEnum } from "admin/organization/organization_edit_view";
import {
  isPricingPlanGreaterEqualThan,
  isUserAllowedToRequestUpgrades,
} from "admin/organization/pricing_plan_utils";
import { Link } from "react-router-dom";
import type { MenuClickEventHandler } from "rc-menu/lib/interface";
import type { OxalisState } from "oxalis/store";

const toolTipMessage = `This feature is not available in your organization's plan. Ask your organization owner to upgrade.`;

const handleMouseClick = (event: React.MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

const handleMenuClick: MenuClickEventHandler = (info) => {
  info.domEvent.preventDefault();
  info.domEvent.stopPropagation();
};

export function PricingEnforcedMenuItem({
  children,
  requiredPricingPlan,
  showLockIcon = true,
  ...menuItemProps
}: {
  children: React.ReactNode;
  requiredPricingPlan: PricingPlanEnum;
  showLockIcon?: boolean;
} & MenuItemProps): JSX.Element {
  const currentPricingPlan = useSelector((state: OxalisState) =>
    state.activeOrganization ? state.activeOrganization.pricingPlan : PricingPlanEnum.Basic,
  );
  const isFeatureAllowed = isPricingPlanGreaterEqualThan(currentPricingPlan, requiredPricingPlan);

  if (isFeatureAllowed) return <Menu.Item {...menuItemProps}>{children}</Menu.Item>;

  return (
    <Tooltip title={toolTipMessage} placement="right">
      <Menu.Item
        onClick={handleMenuClick}
        onAuxClick={handleMouseClick}
        onDoubleClick={handleMouseClick}
        onClickCapture={handleMouseClick}
        className="ant-dropdown-menu-item-disabled"
        {...menuItemProps}
      >
        {children}
        {showLockIcon ? <LockOutlined style={{ marginLeft: 5 }} /> : null}
      </Menu.Item>
    </Tooltip>
  );
}

export function PricingEnforcedButton({
  children,
  requiredPricingPlan,
  showLockIcon = true,
  ...buttonProps
}: {
  children: React.ReactNode;
  requiredPricingPlan: PricingPlanEnum;
  showLockIcon?: boolean;
} & ButtonProps): JSX.Element {
  const currentPricingPlan = useSelector((state: OxalisState) =>
    state.activeOrganization ? state.activeOrganization.pricingPlan : PricingPlanEnum.Basic,
  );
  const isFeatureAllowed = isPricingPlanGreaterEqualThan(currentPricingPlan, requiredPricingPlan);

  if (isFeatureAllowed) return <Button {...buttonProps}>{children}</Button>;

  return (
    <Tooltip title={toolTipMessage} placement="right">
      <Button {...buttonProps} disabled>
        {children}
        {showLockIcon ? <LockOutlined style={{ marginLeft: 5 }} /> : null}
      </Button>
    </Tooltip>
  );
}

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
