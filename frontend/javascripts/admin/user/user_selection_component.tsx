import { getUsers } from "admin/rest_api";
import { Select, Spin } from "antd";
import { handleGenericError } from "libs/error_handling";
import { useFetch } from "libs/react_helpers";
import sortBy from "lodash-es/sortBy";
import { useState } from "react";

type Props = {
  handleSelection: (arg0: string) => void;
};

export default function UserSelectionComponent({ handleSelection }: Props) {
  const [currentUserIdValue, setCurrentUserIdValue] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const users = useFetch(
    async () => {
      try {
        const users = await getUsers();
        const activeUsers = users.filter((u) => u.isActive);

        return sortBy(activeUsers, "lastName");
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
    handleSelection(userId);
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
        label: `${user.lastName}, ${user.firstName} (${user.email})`,
      }))}
    />
  );
}
