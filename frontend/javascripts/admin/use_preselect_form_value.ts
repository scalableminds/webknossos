import type { FormInstance } from "antd";
import { useEffect } from "react";

export function getOnlyItem<T>(items: T[]): T | undefined {
  return items.length === 1 ? items[0] : undefined;
}

/*
 * Fills in a form field with `value`, derived from a query's options, but only while the field
 * is still empty, so the user's choice is never overwritten. Pass the query's
 * `isFetchedAfterMount`, so that only options loaded for this form are used, never cached ones
 * that may contain deleted items. The option queries must not be persisted for this to hold
 * (see NEVER_PERSISTED_QUERY_KEYS in main.tsx).
 */
export function usePreselectFormValue<Values, Name extends keyof Values & string>(
  form: FormInstance<Values>,
  name: Name,
  value: Values[Name] | undefined,
  isFetchedAfterMount: boolean,
) {
  useEffect(() => {
    // antd can't resolve its name-path types for a generic Values, so use the untyped instance.
    // The signature above still ties `value` to the field's type for callers.
    const untypedForm: FormInstance = form;
    if (!isFetchedAfterMount || value == null || untypedForm.getFieldValue(name) != null) {
      return;
    }
    untypedForm.setFieldValue(name, value);
  }, [form, name, value, isFetchedAfterMount]);
}
