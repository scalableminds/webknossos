// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import React from "react";
import type { APIDatasetType } from "admin/api_flow_types";

export default class DatasetActionView extends React.PureComponent {
  form: HTMLFormElement;
  props: {
    dataset: APIDatasetType,
  };

  state: {
    contentType: string,
  } = {
    contentType: "",
  };

  handleSkeletonTraceClick = (event: Event) => {
    this.submitForm("skeletonTracing", event);
  };

  handleVolumeTraceClick = (event: Event) => {
    this.submitForm("volumeTracing", event);
  };

  submitForm(type: string, event: Event) {
    event.preventDefault();
    this.setState({ contentType: type }, () => {
      this.form.submit();
    });
  }

  render() {
    const dataset = this.props.dataset;
    return (
      <div className="nowrap">
        <form
          action={jsRoutes.controllers.AnnotationController.createExplorational().url}
          method="POST"
          ref={form => {
            this.form = form;
          }}
        >
          <input type="hidden" name="dataSetName" value={dataset.name} />
          <input type="hidden" name="contentType" value={this.state.contentType} />
        </form>
        {dataset.dataSource.dataLayers == null
          ? <div>
              <a href={`/datasets/${dataset.name}/import`} className=" import-dataset">
                <i className="fa fa-plus-circle" />import
              </a>

              <div className="import-error">
                <span className="text-danger">
                  {dataset.dataSource.status}
                </span>
              </div>
            </div>
          : null}
        {dataset.isActive
          ? <div className="dataset-actions">
              {dataset.isEditable
                ? <a href={`/datasets/${dataset.name}/edit`} title="Edit dataset">
                    <i className="fa fa-pencil" /> Edit
                  </a>
                : null}
              <a href={`/datasets/${dataset.name}/view`} title="View dataset">
                <img src="/assets/images/eye.svg" alt="eye icon" /> View
              </a>
              <a href="#" title="Create skeleton tracing" onClick={this.handleSkeletonTraceClick}>
                <img src="/assets/images/skeleton.svg" alt="skeleton iocn" /> Start Skeleton Tracing
              </a>
              {dataset.dataStore.typ !== "ndstore"
                ? <a href="#" title="Create volume tracing" onClick={this.handleVolumeTraceClick}>
                    <img src="/assets/images/volume.svg" alt="volume icon" /> Start Volume Tracing
                  </a>
                : null}
            </div>
          : null}
      </div>
    );
  }
}
