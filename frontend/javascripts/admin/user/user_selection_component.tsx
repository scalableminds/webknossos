import { unwrapOrThrow } from "admin/api/api_result";
import { getUsers } from "admin/rest_api";
import { Select, Spin } from "antd";
import { handleGenericError } from "libs/error_handling";
import { useFetch } from "libs/react_helpers";
import sortBy from "lodash-es/sortBy";
import { useState } from "react";
import type { APIUser } from "types/api_types";

type Props = {
  handleSelection: (userId: string, user: APIUser | undefined) => void;
  includeDeactivatedUsers?: boolean;
};

export default function UserSelectionComponent({
  handleSelection,
  includeDeactivatedUsers = false,
}: Props) {
  const [currentUserIdValue, setCurrentUserIdValue] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const users = useFetch(
    async () => {
      try {
        const users = unwrapOrThrow(await getUsers());
        const selectableUsers = includeDeactivatedUsers ? users : users.filter((u) => u.isActive);

        return sortBy(selectableUsers, "lastName");
      } catch (error) {
        handleGenericError(error as Error);
        return [];
      } finally {
        setIsLoading(false);
      }
    },
    [],
    [],
  );

  function handleSelectChange(userId: string) {
    setCurrentUserIdValue(userId);
    handleSelection(
      userId,
      users.find((user) => user.id === userId),
    );
  }

  return isLoading ? (
    <div className="text-center">
      <Spin size="large" />
    </div>
  ) : (
    <Select
      showSearch={{
        optionFilterProp: "label",
        filterOption: (input, option) =>
          // @ts-expect-error ts-migrate (2532) FIXME: Object is possibly 'undefined'.
          option.label.toLowerCase().indexOf(input.toLowerCase()) >= 0,
      }}
      placeholder="Select a New User"
      value={currentUserIdValue}
      onChange={handleSelectChange}
      style={{
        width: "100%",
      }}
      options={users.map((user) => ({
        value: user.id,
        label: `${user.lastName}, ${user.firstName} (${user.email})${user.isActive ? "" : " [deactivated]"}`,
      }))}
    />
  );
}
