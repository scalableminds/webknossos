import { updateOrganization } from "admin/api/organization";
import { getUsers } from "admin/rest_api";
import { useApi, useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { useEffect } from "react";
import { useDispatch } from "react-redux";
import type { APIOrganization } from "types/api_types";
import { enforceActiveOrganization } from "viewer/model/accessors/organization_accessors";
import { setActiveOrganizationAction } from "viewer/model/actions/organization_actions";
import {
  isUserAllowedToManageOrganization,
  isUserAllowedToOrderCredits,
  isUserAllowedToRequestUpgrades,
} from "./pricing_plan_utils";

export function useActiveOrganization(): APIOrganization {
  return useWkSelector((state) => enforceActiveOrganization(state.activeOrganization));
}

export function useCanRequestUpgrades(): boolean {
  return useWkSelector((state) =>
    state.activeUser ? isUserAllowedToRequestUpgrades(state.activeUser) : false,
  );
}

export function useCanOrderCredits(): boolean {
  return useWkSelector((state) =>
    state.activeUser ? isUserAllowedToOrderCredits(state.activeUser) : false,
  );
}

export function useCanManageOrganization(): boolean {
  return useWkSelector((state) =>
    state.activeUser ? isUserAllowedToManageOrganization(state.activeUser) : false,
  );
}

// All organization pages share this query, so switching between them doesn't refetch the users.
export function useOrganizationUsers() {
  const query = useApi({
    queryKey: ["users"],
    queryFn: () => getUsers(),
  });

  useEffect(() => {
    if (query.error) {
      Toast.error("Could not load users.");
      console.error(query.error);
    }
  }, [query.error]);

  return query;
}

type OrganizationChanges = Partial<Pick<APIOrganization, "name" | "newUserMailingList">>;

// Fields that are not changed keep their current value.
export function useUpdateActiveOrganization(): (changes: OrganizationChanges) => Promise<void> {
  const dispatch = useDispatch();
  const organization = useActiveOrganization();

  return async (changes) => {
    const updatedOrganization = await updateOrganization(
      organization.id,
      changes.name ?? organization.name,
      changes.newUserMailingList ?? organization.newUserMailingList,
    );
    dispatch(setActiveOrganizationAction(updatedOrganization));
  };
}
