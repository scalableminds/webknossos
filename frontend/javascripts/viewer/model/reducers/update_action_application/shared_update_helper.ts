import type { WithoutServerSpecificFields } from "viewer/model/sagas/volume/update_actions";

export function withoutServerSpecificFields<T extends { value: Record<string, any> }>(
  ua: T,
): WithoutServerSpecificFields<T> {
  const {
    actionTracingId: _actionTracingId,
    actionTimestamp: _actionTimestamp,
    ...rest
  } = ua.value;
  return {
    ...ua,
    value: rest as Omit<T["value"], "actionTimestamp" | "actionTracingId">,
  } as WithoutServerSpecificFields<T>;
}

export function withoutActionTimestamp<T extends { value: Record<string, any> }>(ua: T) {
  const { actionTimestamp: _actionTimestamp, ...rest } = ua.value;
  return {
    ...ua,
    value: rest as Omit<T["value"], "actionTimestamp">,
  };
}
