import { useWkSelector } from "libs/react_hooks";
import { isUserAllowedToRequestUpgrades } from "./pricing_plan_utils";

export function useCanRequestUpgrades(): boolean {
  return useWkSelector((state) =>
    state.activeUser ? isUserAllowedToRequestUpgrades(state.activeUser) : false,
  );
}
