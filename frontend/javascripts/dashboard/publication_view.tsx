import React, { memo, useState, useEffect } from "react";
import _ from "lodash";
import { List, Input, Spin } from "antd";
import { APIPublication } from "types/api_flow_types";
import PublicationCard from "dashboard/publication_card";
import * as Utils from "libs/utils";
import { getPublications } from "admin/admin_rest_api";
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
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  function handleSearch(event: React.SyntheticEvent<HTMLInputElement>) {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'EventTarg... Remove this comment to see the full error message
    setSearchQuery(event.target.value);
  }

  const search = (
    <Search
      style={{
        width: 200,
        float: "right",
      }}
      placeholder="Search Publication"
      onPressEnter={handleSearch}
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
        model.datasets.flatMap((dataset) => [dataset.name, dataset.description, dataset.details]),
    ],
    props.searchQuery,
  ).sort(
    Utils.compareBy(
      [] as Array<APIPublication>,
      (publication) => publication.publicationDate,
      false,
    ),
  );

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
