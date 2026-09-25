import { useQuery } from "@tanstack/react-query";
import { getPublications } from "admin/rest_api";
import { Flex, Input, Spin, Typography, theme } from "antd";
import PublicationCard from "dashboard/publication_card";
import { handleGenericError } from "libs/error_handling";
import { compareBy, filterWithSearchQueryAND } from "libs/utils";
import type React from "react";
import { useEffect, useState } from "react";
import type { APIPublication } from "types/api_types";

const { Search } = Input;

export function PublicationViewWithHeader() {
  const [searchQuery, setSearchQuery] = useState("");
  const { token } = theme.useToken();

  const {
    data: publications = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["publications"],
    queryFn: getPublications,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (error) {
      handleGenericError(error as Error);
    }
  }, [error]);

  function handleSearch(event: React.ChangeEvent<HTMLInputElement>) {
    setSearchQuery(event.target.value);
  }

  const search = (
    <Search
      style={{
        width: 200,
      }}
      placeholder="Search Publications"
      onChange={handleSearch}
      value={searchQuery}
    />
  );
  return (
    <Flex orientation="vertical" gap="medium" style={{ paddingBottom: token.paddingXL }}>
      {publications.length > 0 && <Flex justify="flex-end">{search}</Flex>}
      <Spin size="large" spinning={isLoading}>
        <div
          style={{
            minHeight: "100px",
          }}
        >
          <PublicationView publications={publications} searchQuery={searchQuery} />
        </div>
      </Spin>
    </Flex>
  );
}
type Props = {
  publications: Array<APIPublication>;
  searchQuery: string;
};

function PublicationView(props: Props) {
  const filteredPublications = filterWithSearchQueryAND(
    props.publications,
    [
      (model) => model.description,
      (model) => model.title,
      (model) =>
        model.datasets.flatMap((dataset) => [dataset.name, dataset.description, dataset.metadata]),
    ],
    props.searchQuery,
  ).sort(compareBy<APIPublication>((publication) => publication.publicationDate, false));

  if (filteredPublications.length === 0) {
    return <PublicationsEmptyText>No featured publications.</PublicationsEmptyText>;
  }

  return (
    <Flex orientation="vertical" gap="medium">
      {filteredPublications.map((publication) => (
        <PublicationCard key={publication.id} publication={publication} showDetailedLink />
      ))}
    </Flex>
  );
}

export function PublicationsEmptyText({ children }: { children: React.ReactNode }) {
  return (
    <Typography.Paragraph type="secondary" style={{ textAlign: "center", padding: 16 }}>
      {children}
    </Typography.Paragraph>
  );
}
