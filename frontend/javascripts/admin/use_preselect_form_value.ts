import type { FormInstance } from "antd";
import { useEffect, useState } from "react";

export function getOnlyItem<T>(items: T[]): T | undefined {
  return items.length === 1 ? items[0] : undefined;
}

/*
 * Whether a query's data was fetched after the calling component mounted. The query cache is
 * persisted and restored after mounting, so react-query's `isFetchedAfterMount` is already true
 * for restored (possibly outdated) data. Pass the query's `dataUpdatedAt`.
 */
export function useIsFetchedSinceMount(dataUpdatedAt: number): boolean {
  const [mountedAt] = useState(() => Date.now());
  return dataUpdatedAt >= mountedAt;
}

/*
 * Fills in a form field once a value to preselect is known (e.g. after its options were
 * loaded), but only while the field is still empty, so the user's choice is never overwritten.
 * Derive the value from freshly fetched options only (see useIsFetchedSinceMount): cached
 * options may contain items that were deleted in the meantime.
 */
export function usePreselectFormValue<Values, Name extends keyof Values & string>(
  form: FormInstance<Values>,
  name: Name,
  value: Values[Name] | undefined,
) {
  useEffect(() => {
    // antd can't resolve its name-path types for a generic Values, so use the untyped instance.
    // The signature above still ties `value` to the field's type for callers.
    const untypedForm: FormInstance = form;
    if (value == null || untypedForm.getFieldValue(name) != null) {
      return;
    }
    untypedForm.setFieldValue(name, value);
  }, [form, name, value]);
}
