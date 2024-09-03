import type React from "react";
import { memo, useState, useEffect } from "react";
import { List, Input, Spin } from "antd";
import type { APIPublication } from "types/api_flow_types";
import PublicationCard from "dashboard/publication_card";
import * as Utils from "libs/utils";
import { getPublications } from "admin/admin_rest_api";
import { handleGenericError } from "libs/error_handling";
const { Search } = Input;
export function PublicationViewWithHeader() {
  const [isLoading, setIsLoading] = useState(false);
  const [publications, setPublications] = useState<Array<APIPublication>>([]);
  const [searchQuery, setSearchQuery] = useState("");
  useEffect(() => {
    (async () => {
      try {
        setIsLoading(true);
        setPublications(await getPublications());
      } catch (error) {
        handleGenericError(error as Error);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  function handleSearch(event: React.ChangeEvent<HTMLInputElement>) {
    setSearchQuery(event.target.value);
  }

  const search = (
    <Search
      style={{
        width: 200,
        float: "right",
      }}
      placeholder="Search Publication"
      onChange={handleSearch}
      value={searchQuery}
    />
  );
  return (
    <div>
      <div className="pull-right">{publications.length > 0 && search}</div>
      <div
        className="clearfix"
        style={{
          margin: "20px 0px",
        }}
      />
      <Spin size="large" spinning={isLoading}>
        <div
          style={{
            minHeight: "100px",
            paddingLeft: 10,
            paddingRight: 10,
          }}
        >
          <PublicationView publications={publications} searchQuery={searchQuery} />
        </div>
      </Spin>
    </div>
  );
}
type Props = {
  publications: Array<APIPublication>;
  searchQuery: string;
};

function PublicationView(props: Props) {
  const filteredPublications = Utils.filterWithSearchQueryAND(
    props.publications,
    [
      (model) => model.description,
      (model) => model.title,
      (model) =>
        model.datasets.flatMap((dataset) => [dataset.name, dataset.description, dataset.metadata]),
    ],
    props.searchQuery,
  ).sort(Utils.compareBy<APIPublication>((publication) => publication.publicationDate, false));

  return (
    <List
      dataSource={filteredPublications}
      locale={{
        emptyText: "No featured publications.",
      }}
      className="antd-no-border-list"
      renderItem={(publication) => (
        <List.Item key={publication.id}>
          <PublicationCard publication={publication} showDetailedLink />
        </List.Item>
      )}
    />
  );
}

export default memo<Props>(PublicationView);
