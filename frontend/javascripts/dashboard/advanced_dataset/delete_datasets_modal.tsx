import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteDatasetOnDisk } from "admin/rest_api";
import { Button, Modal, Progress, Typography } from "antd";
import features from "features";
import Toast from "libs/toast";
import { pluralize } from "libs/utils";
import uniq from "lodash-es/uniq";
import { useState } from "react";
import type { APIDatasetCompact } from "types/api_types";

export function canDeleteDataset(dataset: APIDatasetCompact): boolean {
  return (
    dataset.isEditable && features().allowDeleteDatasets && dataset.status !== "Deleted by user."
  );
}

export function useDeleteDatasetsModal({
  onDeleted,
}: {
  onDeleted?: (deletedIds: string[]) => void;
} = {}) {
  const queryClient = useQueryClient();
  const [datasetsToDelete, setDatasetsToDelete] = useState<APIDatasetCompact[] | null>(null);
  const [progressInPercent, setProgressInPercent] = useState(0);

  const deletableDatasets = (datasetsToDelete ?? []).filter(canDeleteDataset);
  const undeletableCount = (datasetsToDelete?.length ?? 0) - deletableDatasets.length;
  const isSingle = deletableDatasets.length === 1;

  const updateQueryCaches = (datasets: APIDatasetCompact[], deletedIds: string[]) => {
    const deletedDatasets = datasets.filter((ds) => deletedIds.includes(ds.id));
    for (const folderId of uniq(deletedDatasets.map((ds) => ds.folderId))) {
      queryClient.setQueryData(
        ["datasetsByFolder", folderId],
        (oldItems: APIDatasetCompact[] | undefined) =>
          oldItems?.filter((item) => !deletedIds.includes(item.id)),
      );
    }
    queryClient.invalidateQueries({ queryKey: ["dataset", "search"] });
  };

  const deleteDatasetsMutation = useMutation({
    mutationFn: async (datasets: APIDatasetCompact[]) => {
      const deletedIds: string[] = [];
      for (let i = 0; i < datasets.length; i++) {
        const dataset = datasets[i];
        try {
          await deleteDatasetOnDisk(dataset.id);
          deletedIds.push(dataset.id);
          setProgressInPercent(Math.round(((i + 1) / datasets.length) * 100));
        } catch (_e) {
          Toast.error(`Failed to delete dataset ${dataset.name}.`);
        }
      }
      return deletedIds;
    },
    onSuccess: (deletedIds, datasets) => {
      updateQueryCaches(datasets, deletedIds);
      setDatasetsToDelete(null);
      setProgressInPercent(0);

      if (datasets.length === 1 && deletedIds.length === 1) {
        Toast.success(`Successfully deleted dataset ${datasets[0].name}.`);
      } else if (deletedIds.length > 0) {
        Toast.success(
          `Successfully deleted ${deletedIds.length} ${pluralize("dataset", deletedIds.length)}.`,
        );
      }
      if (deletedIds.length > 0) {
        onDeleted?.(deletedIds);
      }
    },
  });

  const isDeleting = deleteDatasetsMutation.isPending;
  const onCancel = () => {
    if (!isDeleting) {
      setDatasetsToDelete(null);
    }
  };

  const deletableDatasetString = `${deletableDatasets.length} ${pluralize("dataset", deletableDatasets.length)}`;

  const deleteModal = (
    <Modal
      open={datasetsToDelete != null}
      title={isSingle ? "Delete Dataset" : `Delete ${deletableDatasetString}`}
      onCancel={onCancel}
      closable={!isDeleting}
      maskClosable={!isDeleting}
      footer={
        isSingle || !isDeleting
          ? [
              <Button key="cancel" onClick={onCancel} disabled={isDeleting}>
                Cancel
              </Button>,
              <Button
                key="delete"
                type="primary"
                danger
                loading={isDeleting}
                disabled={deletableDatasets.length === 0}
                onClick={() => deleteDatasetsMutation.mutate(deletableDatasets)}
              >
                Delete Permanently
              </Button>,
            ]
          : null
      }
    >
      {isDeleting && !isSingle ? (
        <Progress percent={progressInPercent} />
      ) : (
        <>
          {isSingle ? (
            <p>
              Are you sure you want to delete dataset <b>{deletableDatasets[0].name}</b>?
            </p>
          ) : (
            <>
              Are you sure you want to delete the following {deletableDatasetString}?
              <ul>
                {deletableDatasets.map((dataset) => (
                  <li key={dataset.id}>{dataset.name}</li>
                ))}
              </ul>
            </>
          )}
          {undeletableCount > 0 && (
            <p>
              The remaining {undeletableCount} selected {pluralize("dataset", undeletableCount)}{" "}
              cannot be deleted, e.g. because you do not have sufficient permissions.
            </p>
          )}
          <p>Annotations of deleted datasets stay downloadable.</p>
          {/* TODO (#9061): Delete once soft-delete is implemented. */}
          <Typography.Text type="danger" strong>
            This action cannot be undone.
          </Typography.Text>
        </>
      )}
    </Modal>
  );

  return {
    openDeleteModal: (datasets: APIDatasetCompact[]) => setDatasetsToDelete(datasets),
    deleteModal,
  };
}
