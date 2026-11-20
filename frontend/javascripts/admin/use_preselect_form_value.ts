import type { FormInstance } from "antd";
import { useEffect, useState } from "react";

export function getOnlyItem<T>(items: T[]): T | undefined {
  return items.length === 1 ? items[0] : undefined;
}

/*
 * Fills in a form field with `value`, derived from a query's options, but only while the field
 * is still empty, so the user's choice is never overwritten. Pass the query's `dataUpdatedAt`:
 * the query cache is persisted and restored after mounting, so options fetched before this
 * mount may contain items that were deleted in the meantime. They are ignored until the
 * options are refetched (react-query's `isFetchedAfterMount` also counts restored data).
 */
export function usePreselectFormValue<Values, Name extends keyof Values & string>(
  form: FormInstance<Values>,
  name: Name,
  value: Values[Name] | undefined,
  optionsUpdatedAt: number,
) {
  const [mountedAt] = useState(() => Date.now());
  const hasFreshOptions = optionsUpdatedAt >= mountedAt;
  useEffect(() => {
    // antd can't resolve its name-path types for a generic Values, so use the untyped instance.
    // The signature above still ties `value` to the field's type for callers.
    const untypedForm: FormInstance = form;
    if (!hasFreshOptions || value == null || untypedForm.getFieldValue(name) != null) {
      return;
    }
    untypedForm.setFieldValue(name, value);
  }, [form, name, value, hasFreshOptions]);
}
