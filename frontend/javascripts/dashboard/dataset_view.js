// @flow

import React, { useState, useContext, useEffect } from "react";
import { Link, useHistory } from "react-router-dom";
import { Badge, Button, Radio, Col, Dropdown, Icon, Input, Menu, Row, Spin } from "antd";
import { PropTypes } from "@scalableminds/prop-types";

import type { APIUser } from "types/api_flow_types";
import { OptionCard } from "admin/onboarding";
import DatasetTable from "dashboard/advanced_dataset/dataset_table";
import SampleDatasetsModal from "dashboard/dataset/sample_datasets_modal";
import { DatasetCacheContext } from "dashboard/dataset/dataset_cache_provider";
import * as Utils from "libs/utils";
import features, { getDemoDatasetUrl } from "features";
import renderIndependently from "libs/render_independently";
import Persistence from "libs/persistence";

const { Search, Group: InputGroup } = Input;

type Props = {
  user: APIUser,
};

export type DatasetFilteringMode = "showAllDatasets" | "onlyShowReported" | "onlyShowUnreported";

type PersistenceState = {
  searchQuery: string,
  datasetFilteringMode: DatasetFilteringMode,
};

const persistence: Persistence<PersistenceState> = new Persistence(
  {
    searchQuery: PropTypes.string,
    datasetFilteringMode: PropTypes.oneOf([
      "showAllDatasets",
      "onlyShowReported",
      "onlyShowUnreported",
    ]),
  },
  "datasetList",
);

function DatasetView(props: Props) {
  const { user } = props;
  const history = useHistory();
  const context = useContext(DatasetCacheContext);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [datasetFilteringMode, setDatasetFilteringMode] = useState<DatasetFilteringMode>(
    "onlyShowReported",
  );

  useEffect(() => {
    const state = persistence.load(history);
    if (state.searchQuery != null) {
      setSearchQuery(state.searchQuery);
    }
    if (state.datasetFilteringMode != null) {
      setDatasetFilteringMode(state.datasetFilteringMode);
    }
    context.fetchDatasets({
      applyUpdatePredicate: _newDatasets => {
        // Only update the datasets when there are none currently.
        // This avoids sudden changes in the dataset table (since
        // a cached version is already shown). As a result, the
        // dataset list is outdated a bit (shows the list of the
        // last page load). Since a simple page refresh (or clicking
        // the Refresh button) will show a newer version, this is acceptable.
        const updateDatasets = context.datasets.length === 0;
        return updateDatasets;
      },
    });
  }, []);

  useEffect(() => {
    persistence.persist(history, {
      searchQuery,
      datasetFilteringMode,
    });
  }, [searchQuery, datasetFilteringMode]);

  function handleSearch(event: SyntheticInputEvent<>) {
    setSearchQuery(event.target.value);
  }

  function renderSampleDatasetsModal() {
    renderIndependently(destroy => (
      <SampleDatasetsModal
        onOk={context.checkDatasets}
        organizationName={user.organization}
        destroy={destroy}
      />
    ));
  }

  function renderPlaceholder() {
    const noDatasetsPlaceholder =
      "There are no datasets available yet. Please ask an admin or dataset manager to upload a dataset or to grant you permissions to add datasets.";

    const addSampleDatasetCard = (
      <OptionCard
        header="Add Sample Dataset"
        icon={<Icon type="rocket" />}
        action={<Button onClick={renderSampleDatasetsModal}>Add Sample Dataset</Button>}
        height={350}
      >
        This is the easiest way to try out webKnossos. Add one of our sample datasets and start
        exploring in less than a minute.
      </OptionCard>
    );

    const openPublicDatasetCard = (
      <OptionCard
        header="Open Demo Dataset"
        icon={<Icon type="rocket" />}
        action={
          <a href={getDemoDatasetUrl()} target="_blank" rel="noopener noreferrer">
            <Button>Open Dataset</Button>
          </a>
        }
        height={350}
      >
        Have a look at a public dataset to experience webKnossos in action.
      </OptionCard>
    );

    const uploadPlaceholder = (
      <React.Fragment>
        <Row type="flex" gutter={16} justify="center" align="bottom">
          {features().isDemoInstance ? openPublicDatasetCard : addSampleDatasetCard}
          <OptionCard
            header="Upload Dataset"
            icon={<Icon type="cloud-upload-o" />}
            action={
              <Link to="/datasets/upload">
                <Button>Open Import Dialog</Button>
              </Link>
            }
            height={350}
          >
            webKnossos supports a variety of{" "}
            <a href="https://docs.webknossos.org/reference/data_formats">file formats</a> and is
            also able to convert them when necessary.
          </OptionCard>
        </Row>
        <div style={{ marginTop: 24 }}>There are no datasets available yet.</div>
      </React.Fragment>
    );

    return context.isLoading ? null : (
      <Row type="flex" justify="center" style={{ padding: "20px 50px 70px" }} align="middle">
        <Col span={18}>
          <div style={{ paddingBottom: 32, textAlign: "center" }}>
            {Utils.isUserAdminOrDatasetManager(user) ? uploadPlaceholder : noDatasetsPlaceholder}
          </div>
        </Col>
      </Row>
    );
  }

  function renderTable() {
    const filteredDatasets = features().isDemoInstance
      ? context.datasets.filter(d => d.owningOrganization === user.organization)
      : context.datasets;
    return (
      <DatasetTable
        datasets={filteredDatasets}
        searchQuery={searchQuery}
        isUserAdmin={Utils.isUserAdmin(user)}
        isUserTeamManager={Utils.isUserTeamManager(user)}
        isUserDatasetManager={Utils.isUserDatasetManager(user)}
        datasetFilteringMode={datasetFilteringMode}
        updateDataset={context.updateDataset}
      />
    );
  }

  const margin = { marginRight: 5 };
  const createFilteringModeRadio = (key, label) => (
    <Radio
      onChange={() => {
        setDatasetFilteringMode(key);
        context.fetchDatasets({ datasetFilteringMode: key });
      }}
      checked={datasetFilteringMode === key}
    >
      {label}
    </Radio>
  );

  const filterMenu = (
    <Menu onClick={() => {}}>
      <Menu.Item>{createFilteringModeRadio("showAllDatasets", "Show all datasets")}</Menu.Item>
      <Menu.Item>
        {createFilteringModeRadio("onlyShowReported", "Only show available datasets")}
      </Menu.Item>
      <Menu.Item>
        {createFilteringModeRadio("onlyShowUnreported", "Only show missing datasets")}
      </Menu.Item>
    </Menu>
  );
  const searchBox = (
    <Search
      style={{ width: 200 }}
      onPressEnter={handleSearch}
      onChange={handleSearch}
      value={searchQuery}
    />
  );

  const isUserAdminOrDatasetManager = Utils.isUserAdminOrDatasetManager(user);
  const isUserAdminOrDatasetManagerOrTeamManager =
    isUserAdminOrDatasetManager || Utils.isUserTeamManager(user);
  const search = isUserAdminOrDatasetManager ? (
    <InputGroup compact>
      {searchBox}
      <Dropdown overlay={filterMenu} trigger={["click"]}>
        <Button>
          <Badge dot={datasetFilteringMode !== "showAllDatasets"}>
            <Icon type="setting" />
          </Badge>
        </Button>
      </Dropdown>
    </InputGroup>
  ) : (
    searchBox
  );

  const adminHeader = (
    <div className="pull-right" style={{ display: "flex" }}>
      {isUserAdminOrDatasetManagerOrTeamManager ? (
        <React.Fragment>
          <Button
            icon={context.isLoading ? "loading" : "reload"}
            style={margin}
            onClick={context.checkDatasets}
          >
            Refresh
          </Button>
          <Link to="/datasets/upload" style={margin}>
            <Button type="primary" icon="plus">
              Add Dataset
            </Button>
          </Link>
          {search}
        </React.Fragment>
      ) : (
        search
      )}
    </div>
  );

  const isEmpty = context.datasets.length === 0 && datasetFilteringMode !== "onlyShowUnreported";
  const content = isEmpty ? renderPlaceholder() : renderTable();

  return (
    <div>
      {adminHeader}
      <div className="clearfix" style={{ margin: "20px 0px" }} />

      <Spin size="large" spinning={context.datasets.length === 0 && context.isLoading}>
        {content}
      </Spin>
    </div>
  );
}

export default DatasetView;
