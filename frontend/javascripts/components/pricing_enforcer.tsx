import React from "react";
import { useSelector } from "react-redux";
import { Tooltip, Menu, MenuItemProps, Alert } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { PricingPlanEnum } from "admin/organization/organization_edit_view";
import { isPricingPlanGreaterEqualThan } from "admin/organization/pricing_plan_utils";
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

  // TODO show upragde button for owner
  const toolTipMessage = `This feature is not available in your organisation's plan. Ask your organisation owner to upgrade.`;

  const handleMouseClick = (event: React.MouseEvent<HTMLLIElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleMenuClick: MenuClickEventHandler = (info) => {
    info.domEvent.preventDefault();
    info.domEvent.stopPropagation();
  };

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

function PageUnavailableForYourPlan() {
  return (
    <div className="container">
      <Alert
        style={{
          maxWidth: "500px",
          margin: "0 auto",
        }}
        message="Error 404"
        description="Page not found."
        type="error"
        showIcon
      />
    </div>
  );
}
