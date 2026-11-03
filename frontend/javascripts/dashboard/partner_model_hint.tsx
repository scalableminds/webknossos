import { getAiModels, updateNovelUserExperienceInfos } from "admin/rest_api";
import { Alert, Avatar } from "antd";
import { useQueryWithErrorHandling, useWkSelector } from "libs/react_hooks";
import { useMemo } from "react";
import { useDispatch } from "react-redux";
import type { AiModel, APIPartner, APIUser } from "types/api_types";
import { enforceActiveUser } from "viewer/model/accessors/user_accessor";
import { setActiveUserAction } from "viewer/model/actions/user_actions";

/** Points the users of a partner organization to the AI models that the partner provides. */
export function PartnerModelHint() {
  const partner = useWkSelector((state) => state.activeOrganization?.partner ?? null);
  const activeUser = useWkSelector((state) => enforceActiveUser(state.activeUser));
  const undismissedModels = useUndismissedPartnerModels(partner, activeUser);
  const dismissHint = useDismissPartnerModelHint(activeUser);

  if (partner == null) return null;
  return (
    <>
      {undismissedModels.map((model) => (
        <Alert
          key={model.id}
          type="info"
          icon={<Avatar shape="square" src={partner.logoUrl} alt={partner.name} />}
          showIcon
          title={`New AI model for your organization: ${model.name}`}
          description={`${partner.name} provides this model for your organization. To use it, open a dataset, click “AI Analysis” and select it from the pre-trained models.`}
          closable={{ onClose: () => dismissHint(model.id) }}
          style={{ marginBottom: 20 }}
        />
      ))}
    </>
  );
}

function useUndismissedPartnerModels(partner: APIPartner | null, activeUser: APIUser): AiModel[] {
  const { data: models = [] } = useQueryWithErrorHandling(
    {
      // Separate from the ["aiModels"] query of the model selector, whose queryFn filters differently.
      queryKey: ["aiModels", "ofPartner", partner?.id],
      queryFn: async () => {
        const allModels = await getAiModels();
        return allModels.filter((model) => partner != null && model.partnerId === partner.id);
      },
      enabled: partner != null,
    },
    "Could not load the AI models of your organization's partner.",
  );
  const dismissedModelIds = activeUser.novelUserExperienceInfos.dismissedPartnerModelHints;
  return useMemo(
    () => models.filter((model) => !dismissedModelIds?.includes(model.id)),
    [models, dismissedModelIds],
  );
}

function useDismissPartnerModelHint(activeUser: APIUser) {
  const dispatch = useDispatch();
  return (modelId: string) => {
    const dismissedModelIds = activeUser.novelUserExperienceInfos.dismissedPartnerModelHints ?? [];
    const [newUserSync] = updateNovelUserExperienceInfos(activeUser, {
      dismissedPartnerModelHints: [...dismissedModelIds, modelId],
    });
    dispatch(setActiveUserAction(newUserSync));
  };
}
