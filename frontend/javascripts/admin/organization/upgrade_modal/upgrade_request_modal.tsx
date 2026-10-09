import {
  CloseOutlined,
  LockOutlined,
  RocketOutlined,
  SendOutlined,
  UnlockOutlined,
} from "@ant-design/icons";
import { sendUpgradeRequestEmail, type UpgradeRequest } from "admin/api/organization";
import { getUsers } from "admin/rest_api";
import {
  Button,
  Checkbox,
  ConfigProvider,
  Flex,
  Input,
  InputNumber,
  Modal,
  Typography,
  theme,
} from "antd";
import { formatCountToDataAmountUnit, formatNumber } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { getAntdTheme, ModalWidth } from "theme";
import type { APIOrganization } from "types/api_types";
import { enforceActiveOrganization } from "viewer/model/accessors/organization_accessors";
import { getActiveUserCount, PricingPlanEnum } from "../pricing_plan_utils";
import {
  formatPaidUntil,
  formatStorage,
  formatUserCount,
  getCreditBalance,
  getDefaultSelection,
  getEffectiveTier,
  getPlanTier,
  getRequestedTier,
  getTierRank,
  getUpgradeItems,
  getUpgradeTargetTier,
  hasPlanEndDate,
  type ItemDef,
  type ItemId,
  type ItemSelection,
  isTierAtLeast,
  type Selection,
  type UpgradeTargetTier,
} from "./upgrade_request_items";

// Matches UpgradeRequest.maxNoteLength in the backend.
const MAX_NOTE_LENGTH = 10000;
// Keeps custom amounts well within the backend's Int range.
const MAX_CUSTOM_AMOUNT = 1_000_000;

function StatusRow({ label, value }: { label: string; value: React.ReactNode }) {
  const { token } = theme.useToken();
  return (
    <Flex justify="space-between" gap={8}>
      <span style={{ color: token.colorTextTertiary }}>{label}</span>
      <span>{value}</span>
    </Flex>
  );
}

function SidePanelContent({
  organization,
  activeUserCount,
}: {
  organization: APIOrganization;
  activeUserCount: number | null;
}) {
  // Rendered inside the dark theme (see SidePanel), so all tokens are the dark ones.
  const { token } = theme.useToken();
  const isPersonal = getPlanTier(organization.pricingPlan) === PricingPlanEnum.Personal;
  const includedUsers = formatUserCount(organization.includedUsers);
  const includedStorage = formatStorage(organization.includedStorageBytes);

  return (
    <Flex
      vertical
      gap={16}
      style={{
        background: token.colorBgContainer,
        color: token.colorText,
        padding: `${token.paddingXL - 4}px ${token.paddingLG}px`,
      }}
    >
      <Flex
        align="center"
        justify="center"
        style={{
          width: 44,
          height: 44,
          borderRadius: token.borderRadiusLG,
          background: token.colorFillSecondary,
        }}
      >
        <RocketOutlined style={{ fontSize: 24, color: token.colorPrimary }} />
      </Flex>
      <Typography.Title level={3} style={{ margin: 0 }}>
        Upgrade your organization
      </Typography.Title>
      <Typography.Text type="secondary">
        Pick everything you need. We send it to sales as one request.
      </Typography.Text>
      <Flex
        vertical
        gap={10}
        className="upgrade-request-modal-status"
        style={{
          fontSize: 13,
          borderTop: `1px solid ${token.colorSplit}`,
          paddingTop: token.padding,
        }}
      >
        <StatusRow label="Plan" value={organization.pricingPlan.replace("_", " ")} />
        <StatusRow label="Users" value={`${activeUserCount ?? "–"} of ${includedUsers}`} />
        <StatusRow
          label="Storage"
          value={`${formatCountToDataAmountUnit(organization.usedStorageBytes, true)} of ${includedStorage}`}
        />
        {isPersonal ? (
          <StatusRow label="AI Add-on" value="Not available" />
        ) : (
          <>
            <StatusRow
              label="AI credits"
              value={`${formatNumber(getCreditBalance(organization))} left`}
            />
            {hasPlanEndDate(organization) ? (
              <StatusRow label="Renews" value={formatPaidUntil(organization)} />
            ) : null}
          </>
        )}
      </Flex>
      <div style={{ flex: 1 }} />
      <span style={{ color: token.colorTextTertiary, fontSize: token.fontSizeSM }}>
        No payment now. Sales replies with a quote within 1 business day.
      </span>
      <Typography.Link href="https://webknossos.org/pricing" target="_blank" rel="noreferrer">
        Compare all plans
      </Typography.Link>
    </Flex>
  );
}

// The side panel is dark in both the light and the dark app theme.
function SidePanel(props: { organization: APIOrganization; activeUserCount: number | null }) {
  return (
    <ConfigProvider theme={getAntdTheme("dark")}>
      <SidePanelContent {...props} />
    </ConfigProvider>
  );
}

function AmountPicker({
  item,
  selection,
  onChange,
}: {
  item: ItemDef;
  selection: ItemSelection;
  onChange: (selection: ItemSelection) => void;
}) {
  if (item.amounts == null) return null;

  if (selection.custom) {
    return (
      <InputNumber
        min={1}
        max={MAX_CUSTOM_AMOUNT}
        precision={0}
        autoFocus
        value={selection.value}
        onChange={(value) => onChange({ custom: true, value: value ?? undefined })}
        style={{ width: 160 }}
      />
    );
  }

  const chipStyle = { height: 28, paddingInline: 12 };
  return (
    <Flex gap={8} wrap>
      {item.amounts.map((amount) => {
        const isSelected = selection.value === amount.value;
        return (
          <Button
            key={amount.value}
            color={isSelected ? "primary" : "default"}
            variant="outlined"
            style={{ ...chipStyle, fontWeight: isSelected ? 600 : undefined }}
            onClick={() => onChange({ value: amount.value })}
          >
            {amount.label}
          </Button>
        );
      })}
      {item.allowCustom ? (
        <Button
          type="dashed"
          style={chipStyle}
          onClick={() => onChange({ custom: true, value: selection.value })}
        >
          <Typography.Text type="secondary">Other</Typography.Text>
        </Button>
      ) : null}
    </Flex>
  );
}

function ItemRow({
  item,
  selection,
  isLocked,
  isLast,
  onToggle,
  onChange,
}: {
  item: ItemDef;
  selection: ItemSelection | undefined;
  isLocked: boolean;
  isLast: boolean;
  onToggle: (checked: boolean) => void;
  onChange: (selection: ItemSelection) => void;
}) {
  const { token } = theme.useToken();
  const isChecked = selection != null;
  const delta = isChecked ? item.getDelta(selection.value) : null;

  let rightSide: React.ReactNode = null;
  if (delta != null) {
    rightSide = (
      <Typography.Text type="secondary">
        {delta.from} → <Typography.Text strong>{delta.to}</Typography.Text>
      </Typography.Text>
    );
  } else if (!isLocked) {
    rightSide = <Typography.Text type="secondary">{item.hint}</Typography.Text>;
  }

  return (
    <Flex
      vertical
      gap={10}
      style={{
        padding: `${token.paddingSM}px ${token.padding}px`,
        background: isChecked ? token.colorPrimaryBg : undefined,
        borderBottom: isLast ? undefined : `1px solid ${token.colorSplit}`,
      }}
    >
      <Checkbox
        checked={isChecked}
        disabled={isLocked}
        onChange={(event) => onToggle(event.target.checked)}
        style={{ width: "100%" }}
        styles={{ label: { flex: 1, paddingInlineStart: 10 } }}
      >
        <Flex justify="space-between" gap={8}>
          <span style={{ fontWeight: isChecked ? 600 : undefined }}>{item.label}</span>
          {rightSide}
        </Flex>
      </Checkbox>
      {isChecked && item.amounts != null ? (
        <div style={{ paddingInlineStart: 26 }}>
          <AmountPicker item={item} selection={selection} onChange={onChange} />
        </div>
      ) : null}
    </Flex>
  );
}

function GroupLabel({ isUnlocked, tier }: { isUnlocked: boolean; tier: string }) {
  const { token } = theme.useToken();
  return (
    <Flex
      align="center"
      gap={8}
      style={{
        padding: `${token.paddingXS}px ${token.padding}px`,
        background: token.colorFillAlter,
        borderBottom: `1px solid ${token.colorSplit}`,
        color: token.colorTextSecondary,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {isUnlocked ? <UnlockOutlined style={{ color: token.colorPrimary }} /> : <LockOutlined />}
      {isUnlocked ? `Unlocked with ${tier}` : `Needs ${tier} plan`}
    </Flex>
  );
}

function buildUpgradeRequest(
  organization: APIOrganization,
  selection: Selection,
  note: string,
): UpgradeRequest {
  return {
    plan: getRequestedTier(getPlanTier(organization.pricingPlan), selection) ?? undefined,
    users: selection.users?.value,
    storageTB: selection.storage?.value,
    aiAddon: selection.aiAddon != null ? true : undefined,
    credits: selection.credits?.value,
    extendYears: selection.extend?.value,
    note: note.trim() || undefined,
  };
}

export default function UpgradeRequestModal({
  initialItems,
  initialPlan,
  destroy,
}: {
  initialItems: ItemId[];
  // Preselects this plan if the plan row offers a choice between several plans.
  initialPlan?: UpgradeTargetTier;
  destroy: () => void;
}) {
  const { token } = theme.useToken();
  const organization = useWkSelector((state) =>
    enforceActiveOrganization(state.activeOrganization),
  );
  const activeUser = useWkSelector((state) => state.activeUser);

  const canOrderCredits = activeUser?.isOrganizationOwner ?? false;
  const items = useMemo(
    () => getUpgradeItems(organization, canOrderCredits),
    [organization, canOrderCredits],
  );
  const currentTier = getPlanTier(organization.pricingPlan);
  const targetTier = getUpgradeTargetTier(currentTier);

  const [selection, setSelection] = useState<Selection>(() => {
    const initialSelection: Selection = {};
    for (const item of items) {
      if (initialItems.includes(item.id)) initialSelection[item.id] = getDefaultSelection(item);
    }
    // Preselecting an item that needs a higher plan also adds that plan upgrade to the request.
    const planItem = items.find((item) => item.id === "plan");
    const needsPlanUpgrade = items.some(
      (item) => initialSelection[item.id] != null && !isTierAtLeast(currentTier, item.minPlan),
    );
    if (needsPlanUpgrade && planItem != null && initialSelection.plan == null) {
      initialSelection.plan = getDefaultSelection(planItem);
    }
    const initialPlanRank = initialPlan != null ? getTierRank(initialPlan) : null;
    if (
      initialSelection.plan != null &&
      planItem?.amounts?.some((amount) => amount.value === initialPlanRank)
    ) {
      initialSelection.plan = { value: initialPlanRank ?? undefined };
    }
    return initialSelection;
  });
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeUserCount, setActiveUserCount] = useState<number | null>(null);

  useEffect(() => {
    getUsers().then((result) => {
      if (result.ok) setActiveUserCount(getActiveUserCount(result.value));
    });
  }, []);

  const effectiveTier = getEffectiveTier(currentTier, selection);
  const isLocked = (item: ItemDef) => !isTierAtLeast(effectiveTier, item.minPlan);
  const hasLockableItems = items.some((item) => !isTierAtLeast(currentTier, item.minPlan));

  const toggleItem = (item: ItemDef, checked: boolean) => {
    setSelection((previous) => {
      const next = { ...previous };
      if (checked) {
        next[item.id] = getDefaultSelection(item);
        return next;
      }
      delete next[item.id];
      if (item.id === "plan") {
        // Items that were only unlocked by the plan upgrade are dropped together with it.
        for (const otherItem of items) {
          if (!isTierAtLeast(currentTier, otherItem.minPlan)) delete next[otherItem.id];
        }
      }
      return next;
    });
  };

  const updateItem = (itemId: ItemId, itemSelection: ItemSelection) => {
    setSelection((previous) => ({ ...previous, [itemId]: itemSelection }));
  };

  const selectedItems = items.filter((item) => selection[item.id] != null);
  const hasIncompleteAmount = selectedItems.some(
    (item) => item.amounts != null && selection[item.id]?.value == null,
  );
  const canSubmit = selectedItems.length > 0 && !hasIncompleteAmount;

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await sendUpgradeRequestEmail(buildUpgradeRequest(organization, selection, note));
      Toast.success("Request sent. Sales will reply within 1 business day.");
      destroy();
    } catch (error) {
      console.error(error);
      Toast.error("Could not send the upgrade request. Please try again.");
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onCancel={destroy}
      footer={null}
      closable={false}
      width={ModalWidth.Large}
      zIndex={10000} // overlay everything
      styles={{
        container: { padding: 0, overflow: "hidden", borderRadius: token.borderRadiusLG },
      }}
    >
      <div className="upgrade-request-modal">
        <SidePanel organization={organization} activeUserCount={activeUserCount} />
        <Flex vertical gap={16} style={{ padding: token.paddingLG, minWidth: 0 }}>
          <Flex justify="space-between" align="flex-start">
            <div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>What do you need?</div>
              <Typography.Text type="secondary">Tick one or more</Typography.Text>
            </div>
            <Button
              type="text"
              size="small"
              aria-label="Close"
              icon={<CloseOutlined style={{ color: token.colorTextSecondary }} />}
              onClick={destroy}
            />
          </Flex>

          <div
            style={{
              border: `1px solid ${token.colorSplit}`,
              borderRadius: token.borderRadius,
              overflow: "hidden",
            }}
          >
            {items.map((item, index) => (
              <div key={item.id}>
                <ItemRow
                  item={item}
                  selection={selection[item.id]}
                  isLocked={isLocked(item)}
                  isLast={index === items.length - 1}
                  onToggle={(checked) => toggleItem(item, checked)}
                  onChange={(itemSelection) => updateItem(item.id, itemSelection)}
                />
                {item.id === "plan" && hasLockableItems && targetTier != null ? (
                  <GroupLabel
                    isUnlocked={selection.plan != null}
                    tier={selection.plan != null ? effectiveTier : targetTier}
                  />
                ) : null}
              </div>
            ))}
          </div>

          <Flex vertical gap={6}>
            <div>
              <Typography.Text strong>Anything else?</Typography.Text>{" "}
              <Typography.Text type="secondary">Optional</Typography.Text>
            </div>
            <Input.TextArea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              autoSize={{ minRows: 2 }}
              maxLength={MAX_NOTE_LENGTH}
              placeholder="E.g. a purchase order number, a different billing contact or a custom amount"
            />
          </Flex>

          <Flex justify="flex-end" gap={8}>
            <Button onClick={destroy}>Cancel</Button>
            <Button
              type="primary"
              icon={<SendOutlined />}
              disabled={!canSubmit}
              loading={isSubmitting}
              onClick={handleSubmit}
            >
              Send request
            </Button>
          </Flex>
        </Flex>
      </div>
    </Modal>
  );
}
