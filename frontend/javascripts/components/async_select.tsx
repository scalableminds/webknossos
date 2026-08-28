import { Select, Spin } from "antd";
import type { SelectProps } from "antd/es/select";
import debounce from "lodash-es/debounce";
import type React from "react";
import { useMemo, useRef, useState } from "react";

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

export default function AsyncSelect<
  ValueType extends { key?: string; label: React.ReactNode; value: string | number } = any,
>({ fetchOptions, debounceTimeout = 300, ...props }: AsyncSelectProps<ValueType>) {
  const [fetching, setFetching] = useState(false);
  const [options, setOptions] = useState<ValueType[]>([]);
  const fetchRef = useRef(0);

  const debounceFetcher = useMemo(() => {
    const loadOptions = (value: string) => {
      fetchRef.current += 1;
      const fetchId = fetchRef.current;
      setOptions([]);
      setFetching(true);

      fetchOptions(value).then((newOptions) => {
        if (fetchId !== fetchRef.current) {
          // for fetch callback order
          return;
        }

        setOptions(newOptions);
        setFetching(false);
      });
    };

    return debounce(loadOptions, debounceTimeout);
  }, [fetchOptions, debounceTimeout]);

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
