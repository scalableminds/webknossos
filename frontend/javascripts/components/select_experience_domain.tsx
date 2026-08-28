import { useQuery } from "@tanstack/react-query";
import { getExistingExperienceDomains } from "admin/rest_api";
import { Select, Tooltip } from "antd";
import type React from "react";
import { useState } from "react";
import type { ExperienceDomainList } from "types/api_types";

type Props = {
  value?: string | Array<string>;
  width: number;
  placeholder: string;
  notFoundContent?: string;
  disabled: boolean;
  onSelect?: (arg0: string) => void;
  onChange?: () => void;
  allowCreation?: boolean;
  alreadyUsedDomains?: ExperienceDomainList;
};

const SelectExperienceDomain: React.FC<Props> = ({
  value,
  notFoundContent,
  width,
  disabled,
  placeholder,
  onSelect,
  onChange,
  allowCreation = false,
  alreadyUsedDomains = [],
}) => {
  const { data: domains = [] } = useQuery({
    queryKey: ["experienceDomains"],
    queryFn: getExistingExperienceDomains,
  });
  const [currentlyEnteredDomain, setCurrentlyEnteredDomain] = useState("");

  const getUnusedDomains = (): ExperienceDomainList => {
    return domains.filter((domain) => !alreadyUsedDomains.includes(domain));
  };

  const onSearch = (domain: string) => {
    setCurrentlyEnteredDomain(domain);
  };

  let selectableDomains = getUnusedDomains();

  if (
    allowCreation &&
    !selectableDomains.includes(currentlyEnteredDomain) &&
    currentlyEnteredDomain.trim() !== ""
  ) {
    selectableDomains = [...selectableDomains, currentlyEnteredDomain];
  }

  return (
    <Tooltip
      placement="top"
      title="Select an existing experience domain or create a new one by typing its name in this input field."
    >
      <Select
        showSearch
        value={value}
        optionFilterProp="label"
        notFoundContent={notFoundContent}
        style={{
          width: `${width}%`,
        }}
        disabled={disabled}
        placeholder={placeholder}
        onSelect={onSelect}
        onChange={onChange}
        onSearch={onSearch}
        options={selectableDomains.map((domain) => ({ value: domain, label: domain }))}
      />
    </Tooltip>
  );
};

export default SelectExperienceDomain;
