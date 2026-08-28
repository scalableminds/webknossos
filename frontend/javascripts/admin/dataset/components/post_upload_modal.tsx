import { Button, Modal } from "antd";
import { Fragment } from "react";
import type { useNavigate } from "react-router-dom";
import { getReadableURLPart, getViewDatasetURL } from "viewer/model/accessors/dataset_accessor";
import type { DatasetAddType } from "../dataset_add_view";

const addTypeToVerb: Record<DatasetAddType, string> = {
  upload: "uploaded",
  remote: "added",
  compose: "created",
};

type Props = {
  datasetNeedsConversion: boolean;
  datasetAddType: DatasetAddType;
  datasetId: string;
  uploadedDatasetName: string;
  setDatasetId: (arg0: string) => void;
  navigate: ReturnType<typeof useNavigate>;
};

export default function PostUploadModal({
  datasetNeedsConversion,
  datasetAddType,
  datasetId,
  uploadedDatasetName,
  setDatasetId,
  navigate,
}: Props) {
  return (
    <Modal
      open
      closable
      mask={{ closable: false }}
      footer={null}
      onCancel={() => setDatasetId("")}
      onOk={() => setDatasetId("")}
      width={580}
    >
      <div
        style={{
          fontSize: 20,
          paddingTop: 13,
          textAlign: "center",
        }}
      >
        The dataset was {addTypeToVerb[datasetAddType]} successfully
        {datasetNeedsConversion ? " and a conversion job was started" : null}.
        <br />
        <div
          className="centered-items"
          style={{
            marginTop: 10,
          }}
        >
          {datasetNeedsConversion ? (
            <Fragment>
              <Button type="primary" onClick={() => navigate("/jobs")}>
                View the Jobs Queue
              </Button>
              <Button onClick={() => navigate("/dashboard/datasets")}>Go to Dashboard</Button>
            </Fragment>
          ) : (
            <Fragment>
              <Button
                type="primary"
                onClick={() =>
                  navigate(getViewDatasetURL({ name: uploadedDatasetName, id: datasetId }))
                }
              >
                View the Dataset
              </Button>
              <Button
                onClick={() =>
                  navigate(
                    `/datasets/${getReadableURLPart({ name: uploadedDatasetName, id: datasetId })}/edit`,
                  )
                }
              >
                Go to Dataset Settings
              </Button>
              <Button onClick={() => navigate("/dashboard/datasets")}>Go to Dashboard</Button>
            </Fragment>
          )}
        </div>
      </div>
    </Modal>
  );
}
