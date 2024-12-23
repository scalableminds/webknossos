import { Spin, Select } from "antd";
import _ from "lodash";
import { getUsers } from "admin/admin_rest_api";
import { useFetch } from "libs/react_helpers";
import { useState } from "react";
import { handleGenericError } from "libs/error_handling";

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

        return _.sortBy(activeUsers, "lastName");
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
      showSearch
      placeholder="Select a New User"
      value={currentUserIdValue}
      onChange={handleSelectChange}
      optionFilterProp="label"
      style={{
        width: "100%",
      }}
      filterOption={(input, option) =>
        // @ts-expect-error ts-migrate (2532) FIXME: Object is possibly 'undefined'.
        option.label.toLowerCase().indexOf(input.toLowerCase()) >= 0
      }
      options={users.map((user) => ({
        value: user.id,
        label: `${user.lastName}, ${user.firstName} (${user.email})`,
      }))}
    />
  );
}
