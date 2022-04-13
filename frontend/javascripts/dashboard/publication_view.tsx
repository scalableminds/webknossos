import React, { memo, useContext, useState, useEffect } from "react";
import _ from "lodash";
import { List, Input, Spin } from "antd";
import type { APIDataset, APIMaybeUnimportedDataset } from "types/api_flow_types";
import PublicationCard from "dashboard/publication_card";
import { DatasetCacheContext } from "dashboard/dataset/dataset_cache_provider";
import * as Utils from "libs/utils";
const { Search } = Input;
export function PublicationViewWithHeader() {
  const context = useContext(DatasetCacheContext);
  const [searchQuery, setSearchQuery] = useState("");
  useEffect(() => {
    context.fetchDatasets();
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
      <div className="pull-right">{context.datasets.length > 0 && search}</div>
      <div
        className="clearfix"
        style={{
          margin: "20px 0px",
        }}
      />
      <Spin size="large" spinning={context.isLoading}>
        <div
          style={{
            minHeight: "100px",
            paddingLeft: 10,
            paddingRight: 10,
          }}
        >
          <PublicationView datasets={context.datasets} searchQuery={searchQuery} />
        </div>
      </Spin>
    </div>
  );
}
type Props = {
  datasets: Array<APIMaybeUnimportedDataset>;
  searchQuery: string;
};

function PublicationView(props: Props) {
  // $FlowIssue[incompatible-type] flow doesn't check that after filtering there are only imported datasets left
  const activeDatasets: APIDataset[] = props.datasets.filter((ds) => ds.isActive) as APIDataset[];
  const filteredDatasets = Utils.filterWithSearchQueryAND(
    activeDatasets,
    [
      (model) => (model.publication != null ? model.publication.description : ""),
      (model) => (model.publication != null ? model.publication.title : ""),
      "name",
      "description",
      "details",
    ],
    props.searchQuery,
  );

  const datasetsByPublication = _.chain(filteredDatasets)
    .filter((dataset) => dataset.publication != null)
    .groupBy("publication.id")
    .values()
    .sort(
      // Sort publication groups by publication creation date
      Utils.compareBy(
        [] as Array<APIDataset>,
        (datasets) => datasets[0].publication.publicationDate,
        false,
      ),
    );

  return (
    <List
      // @ts-expect-error ts-migrate(2740) FIXME: Type 'CollectionChain<any[]>' is missing the follo... Remove this comment to see the full error message
      dataSource={datasetsByPublication}
      locale={{
        emptyText: "No featured publications.",
      }}
      className="antd-no-border-list"
      renderItem={(datasets) => (
        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
        <List.Item key={datasets[0].publication.id}>
          <PublicationCard className="dataset-panel" datasets={datasets} showDetailedLink />
        </List.Item>
      )}
    />
  );
}

export default memo<Props>(PublicationView);
