import React from "react";
import { useSelector } from "react-redux";
import { Tooltip, Menu, MenuItemProps, Alert } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { PricingPlanEnum } from "admin/organization/organization_edit_view";
import { isPricingPlanGreaterEqualThan } from "admin/organization/pricing_plan_utils";
import { Link } from "react-router-dom";
import type { MenuClickEventHandler } from "rc-menu/lib/interface";
import type { OxalisState } from "oxalis/store";

export default function PricingEnforcedMenuItem({
  children,
  requiredPricingPlan,
  showLockIcon = true,
  ...menuItemProps
}: {
  children: JSX.Element;
  requiredPricingPlan: PricingPlanEnum;
  showLockIcon?: boolean;
} & MenuItemProps): JSX.Element {
  const currentPricingPlan = useSelector((state: OxalisState) =>
    state.activeOrganization ? state.activeOrganization.pricingPlan : PricingPlanEnum.Basic,
  );
  const isFeatureAllowed = isPricingPlanGreaterEqualThan(currentPricingPlan, requiredPricingPlan);

  if (isFeatureAllowed) return <Menu.Item {...menuItemProps}>{children}</Menu.Item>;

  const handleMouseClick = (event: React.MouseEvent<HTMLLIElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleMenuClick: MenuClickEventHandler = (info) => {
    info.domEvent.preventDefault();
    info.domEvent.stopPropagation();
  };

  const toolTipMessage = `This feature is not available in your organisation's plan. Ask your organisation owner to upgrade.`;

  return (
    <Tooltip title={toolTipMessage} placement="right">
      <Menu.Item
        onClick={handleMenuClick}
        onAuxClick={handleMouseClick}
        onDoubleClick={handleMouseClick}
        onClickCapture={handleMouseClick}
        {...menuItemProps}
      >
        {children}
        {showLockIcon ? <LockOutlined style={{ marginLeft: 5 }} /> : null}
      </Menu.Item>
    </Tooltip>
  );
}

export function PageUnavailableForYourPlanView() {
  const organizationName = useSelector((state: OxalisState) => state.activeOrganization?.name);

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
            <Link to={`/organizations/${organizationName}`}>Go to Organization Settings</Link>
          </>
        }
        type="error"
        showIcon
      />
    </div>
  );
}
