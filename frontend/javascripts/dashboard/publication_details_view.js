// @flow
import * as React from "react";
import _ from "lodash";

import type { APIDataset, APIMaybeUnimportedDataset } from "admin/api_flow_types";
import PublicationCard from "dashboard/publication_card";

type Props = {
  datasets: Array<APIMaybeUnimportedDataset>,
  publicationId: string
};

class PublicationVDetailiew extends React.PureComponent<Props> {
  render() {
    // $FlowFixMe flow doesn't check that after filtering there are only imported datasets left
    const activeDatasets: Array<APIDataset> = this.props.datasets.filter(ds => 
      ds.isActive);
      const theChosenDatasets = activeDatasets.filter(ds => ds.publication != null && ds.publication.id === this.props.publicationId);
    return (
              theChosenDatasets.length > 0 ? <PublicationCard className="dataset-panel" datasets={theChosenDatasets} /> : null
    );
  }
}

export default PublicationVDetailiew;
