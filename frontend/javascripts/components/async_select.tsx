import { Select, Spin } from "antd";
import type { SelectProps } from "antd/es/select";
import debounce from "lodash-es/debounce";
import type React from "react";
import { useMemo, useState } from "react";

// This module is inspired by the "Search and Select Users" example
// in the antd documentation (for version 6).
// https://ant.design/components/select#select-demo-select-users
// Quote:
// A complete multiple select sample with remote search, debounce fetch, ajax callback order flow, and loading state.

interface AsyncSelectProps<ValueType = any>
  extends Omit<SelectProps<ValueType | ValueType[]>, "options" | "children"> {
  fetchOptions: (search: string) => Promise<ValueType[]>;
  debounceTimeout?: number;
}

/**
 * Returns a debounced function that fetches the options for a search string.
 * Results of a fetch are ignored if a newer fetch was started in the meantime.
 */
function createDebouncedOptionsLoader<ValueType>(
  fetchOptions: (search: string) => Promise<ValueType[]>,
  debounceTimeout: number,
  setOptions: (options: ValueType[]) => void,
  setFetching: (fetching: boolean) => void,
) {
  let latestFetchId = 0;
  const loadOptions = (value: string) => {
    latestFetchId += 1;
    const fetchId = latestFetchId;
    setOptions([]);
    setFetching(true);

    fetchOptions(value).then((newOptions) => {
      if (fetchId !== latestFetchId) {
        // for fetch callback order
        return;
      }

      setOptions(newOptions);
      setFetching(false);
    });
  };

  return debounce(loadOptions, debounceTimeout);
}

export default function AsyncSelect<
  ValueType extends { key?: string; label: React.ReactNode; value: string | number } = any,
>({ fetchOptions, debounceTimeout = 300, ...props }: AsyncSelectProps<ValueType>) {
  const [fetching, setFetching] = useState(false);
  const [options, setOptions] = useState<ValueType[]>([]);

  const debounceFetcher = useMemo(
    () => createDebouncedOptionsLoader(fetchOptions, debounceTimeout, setOptions, setFetching),
    [fetchOptions, debounceTimeout],
  );

  return (
    <Select
      labelInValue
      showSearch={{ filterOption: false, onSearch: debounceFetcher }}
      notFoundContent={fetching ? <Spin size="small" /> : "No results found"}
      {...props}
      options={options}
      // Clear suggestions after the user selected one to avoid confusion.
      // Otherwise, the user could click into the select field and the old
      // suggestions would be shown (from the typed string that is now gone).
      // The user might think that these are all available entries. However,
      // inputting a new string will show new suggestions.
      onSelect={() => setOptions([])}
    />
  );
}
