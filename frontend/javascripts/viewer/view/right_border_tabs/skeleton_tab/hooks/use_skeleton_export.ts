import { getBuildInfo } from "admin/rest_api";
import { saveAs } from "file-saver";
import { useQueryWithErrorHandling } from "libs/react_hooks";
import Toast from "libs/toast";
import { sleep } from "libs/utils";
import { useCallback, useState } from "react";
import {
  getTreeEdgesAsCSV,
  getTreeNodesAsCSV,
  getTreesAsCSV,
} from "viewer/model/helpers/csv_helpers";
import { getNmlName, serializeToNml } from "viewer/model/helpers/nml_helpers";
import Store from "viewer/store";

export type PendingExport = "nml" | "csv" | null;

export type SkeletonExport = {
  pendingExport: PendingExport;
  downloadNml: (applyTransforms: boolean) => Promise<void>;
  downloadCsv: (applyTransforms: boolean) => Promise<void>;
};

export function useSkeletonExport(): SkeletonExport {
  const [pendingExport, setPendingExport] = useState<PendingExport>(null);
  // Prefetch the build info (it is included in NML metadata), so that the
  // download itself doesn't have to wait for the server.
  const buildInfoQuery = useQueryWithErrorHandling(
    {
      queryKey: ["buildInfo"],
      queryFn: getBuildInfo,
      staleTime: Number.POSITIVE_INFINITY,
    },
    "Could not fetch the server's build information.",
  );

  const downloadNml = useCallback(
    async (applyTransforms: boolean) => {
      setPendingExport("nml");
      try {
        // Wait a moment so that the progress modal is rendered before the
        // (potentially heavy, synchronous) serialization blocks the UI.
        const [buildInfo] = await Promise.all([buildInfoQuery.data ?? getBuildInfo(), sleep(1000)]);
        const state = Store.getState();
        const skeletonTracing = state.annotation.skeleton;
        if (skeletonTracing == null) {
          return;
        }
        const nml = serializeToNml(
          state,
          state.annotation,
          skeletonTracing,
          buildInfo,
          applyTransforms,
        );
        const blob = new Blob([nml], {
          type: "text/plain;charset=utf-8",
        });
        saveAs(blob, getNmlName(state));
      } finally {
        setPendingExport(null);
      }
    },
    [buildInfoQuery.data],
  );

  const downloadCsv = useCallback(async (applyTransforms: boolean) => {
    setPendingExport("csv");

    try {
      // @zip.js is a fairly large module.
      // Dynamically import it to avoid loading it on Dashboard/admin pages.
      const { BlobWriter, ZipWriter, TextReader } = await import("@zip.js/zip.js");

      const state = Store.getState();
      const skeletonTracing = state.annotation.skeleton;
      if (skeletonTracing == null) {
        return;
      }
      const { annotationId } = state.annotation;
      const datasetUnit = state.dataset.dataSource.scale.unit;

      const treesCsv = getTreesAsCSV(annotationId, skeletonTracing, datasetUnit);
      const nodesCsv = getTreeNodesAsCSV(state, skeletonTracing, applyTransforms, datasetUnit);
      const edgesCsv = getTreeEdgesAsCSV(annotationId, skeletonTracing);

      const blobWriter = new BlobWriter("application/zip");
      const writer = new ZipWriter(blobWriter);
      await writer.add("trees.csv", new TextReader(treesCsv));
      await writer.add("nodes.csv", new TextReader(nodesCsv));
      await writer.add("edges.csv", new TextReader(edgesCsv));
      await writer.close();
      saveAs(await blobWriter.getData(), "tree_export.zip");
    } catch (error) {
      Toast.error("Could not export trees. See the console for details.");
      console.error(error);
    } finally {
      setPendingExport(null);
    }
  }, []);

  return { pendingExport, downloadNml, downloadCsv };
}
