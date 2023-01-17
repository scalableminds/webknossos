import { LockOutlined } from "@ant-design/icons";
import { PricingPlanEnum } from "admin/organization/organization_edit_view";
import { isPricingPlanGreaterEqualThan } from "admin/organization/pricing_plan_utils";
import { Tooltip, Menu, MenuItemProps } from "antd";
import { MenuClickEventHandler } from "rc-menu/lib/interface";
import * as React from "react";

export default function PricingEnforcedMenuItem({
  children,
  requiredPricingPlan,
  showLockIcon = true,
  ...args
}: {
  children: JSX.Element;
  requiredPricingPlan: PricingPlanEnum;
  showLockIcon?: boolean;
} & MenuItemProps): JSX.Element {
  const isFeatureAllowed = false;
  // const isFeatureAllowed = isPricingPlanGreaterThan(organization.pricingPlan, requiredPricingPlan);

  if (isFeatureAllowed) return children;

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

  // onClick = { handleMouseClick };
  // onAuxClick = { handleMouseClick };
  // onDoubleClick = { handleMouseClick };
  // onClickCapture = { handleMouseClick };

  return (
    <Tooltip title={toolTipMessage} placement="bottom">
        <Menu.Item
          icon={showLockIcon ? <LockOutlined /> : null}
          onClick={handleMenuClick}
          onAuxClick={handleMouseClick}
          onDoubleClick={handleMouseClick}
          onClickCapture={handleMouseClick}
        >
          {children}
        </Menu.Item>
    </Tooltip>
  );
}
