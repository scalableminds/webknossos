import type { Entry } from "@zip.js/zip.js";
import { clearCache, importVolumeTracing } from "admin/rest_api";
import { readFileAsArrayBuffer, readFileAsText } from "libs/read_file";
import Toast from "libs/toast";
import { isFileExtensionEqualTo, promiseAllWithErrors } from "libs/utils";
import last from "lodash-es/last";
import { getActiveSegmentationTracing } from "viewer/model/accessors/volumetracing_accessor";
import { addUserBoundingBoxesAction } from "viewer/model/actions/annotation_actions";
import { setVersionNumberAction } from "viewer/model/actions/save_actions";
import { addTreesAndGroupsAction } from "viewer/model/actions/skeletontracing_actions";
import {
  importVolumeTracingAction,
  setLargestSegmentIdAction,
} from "viewer/model/actions/volumetracing_actions";
import { NmlParseError, parseNml, wrapInNewGroup } from "viewer/model/helpers/nml_helpers";
import { parseProtoTracing } from "viewer/model/helpers/proto_helpers";
import { createMutableTreeMapFromTreeArray } from "viewer/model/reducers/skeletontracing_reducer_helpers";
import type { MutableTreeMap, TreeGroup } from "viewer/model/types/tree_types";
import { api, Model } from "viewer/singletons";
import Store, { type UserBoundingBox } from "viewer/store";

// Thrown while importing a volume annotation ZIP when the import cannot proceed
// (e.g. there is no editable volume layer, or the server rejected the data). Unlike
// generic parsing failures, the message of this error is user-facing and should be
// surfaced instead of being replaced by the generic "could not be parsed" message.
class VolumeImportError extends Error {
  name = "VolumeImportError";
}

export async function importTracingFiles(files: Array<File>, createGroupForEachFile: boolean) {
  try {
    const wrappedAddTreesAndGroupsAction = (
      trees: MutableTreeMap,
      treeGroups: TreeGroup[],
      groupName: string,
      userBoundingBoxes?: UserBoundingBox[],
    ) => {
      const actions =
        userBoundingBoxes && userBoundingBoxes.length > 0
          ? [addUserBoundingBoxesAction(userBoundingBoxes)]
          : [];

      if (createGroupForEachFile) {
        const [wrappedTrees, wrappedTreeGroups] = wrapInNewGroup(trees, treeGroups, groupName);
        return [...actions, addTreesAndGroupsAction(wrappedTrees, wrappedTreeGroups)];
      } else {
        return [...actions, addTreesAndGroupsAction(trees, treeGroups)];
      }
    };

    const tryParsingFileAsNml = async (file: File, warnAboutVolumes: boolean = true) => {
      try {
        const nmlString = await readFileAsText(file);
        const { trees, treeGroups, userBoundingBoxes, datasetName, containedVolumes } =
          await parseNml(nmlString);
        if (containedVolumes && warnAboutVolumes) {
          Toast.warning(
            "The NML file contained volume information which was ignored. Please upload the NML into the dashboard to create a new annotation which also contains the volume data.",
          );
        }
        return {
          importActions: wrappedAddTreesAndGroupsAction(
            trees,
            treeGroups,
            file.name,
            userBoundingBoxes,
          ),
          datasetName,
        };
      } catch (error) {
        if (error instanceof NmlParseError) {
          // NmlParseError means the file we're dealing with is an NML-like file, but there was
          // an error during the validation.
          // In that case we want to show the validation error instead of the generic one.
          throw error;
        }

        // @ts-expect-error
        console.error(`Tried parsing file "${file.name}" as NML but failed. ${error.message}`);
        return undefined;
      }
    };

    const tryParsingFileAsProtobuf = async (file: File) => {
      try {
        const nmlProtoBuffer = await readFileAsArrayBuffer(file);
        const parsedTracing = parseProtoTracing(nmlProtoBuffer, "skeleton");

        if (!("trees" in parsedTracing)) {
          // This check is only for TS to realize that we have a skeleton tracing
          // on our hands.
          throw new Error("Skeleton tracing doesn't contain trees");
        }

        return {
          importActions: wrappedAddTreesAndGroupsAction(
            createMutableTreeMapFromTreeArray(parsedTracing.trees),
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'TreeGroup[] | null | undefined' ... Remove this comment to see the full error message
            parsedTracing.treeGroups,
            file.name,
          ),
        };
      } catch (error) {
        // @ts-expect-error
        console.error(`Tried parsing file "${file.name}" as protobuf but failed. ${error.message}`);
        return undefined;
      }
    };

    const tryParsingFileAsZip = async (file: File) => {
      try {
        // @zip.js is a fairly large module
        // Dynamically import it to avoid loading it on Dashboard/admin pages.
        const { BlobReader, ZipReader, BlobWriter } = await import("@zip.js/zip.js");

        const reader = new ZipReader(new BlobReader(file));
        const entries = await reader.getEntries();
        const nmlFileEntry = entries.find((entry: Entry) =>
          isFileExtensionEqualTo(entry.filename, "nml"),
        );

        if (nmlFileEntry == null) {
          await reader.close();
          throw Error("Zip file doesn't contain an NML file.");
        }

        // The type definitions for getData are inaccurate. It is defined for entries obtained through calling ZipReader.getEntries, see https://github.com/gildas-lormeau/zip.js/issues/371#issuecomment-1272316813
        const nmlBlob = await nmlFileEntry.getData!(new BlobWriter());
        const nmlFile = new File([nmlBlob], nmlFileEntry.filename);

        const nmlImportActions = await tryParsingFileAsNml(nmlFile, false);

        const dataFileEntry = entries.find((entry: Entry) =>
          isFileExtensionEqualTo(entry.filename, "zip"),
        );

        if (dataFileEntry) {
          // The type definitions for getData are inaccurate. It is defined for entries obtained through calling ZipReader.getEntries, see https://github.com/gildas-lormeau/zip.js/issues/371#issuecomment-1272316813
          const dataBlob = await dataFileEntry.getData!(new BlobWriter());
          const dataFile = new File([dataBlob], dataFileEntry.filename);
          await Model.ensureSavedState();
          const storeState = Store.getState();
          const { annotation, dataset } = storeState;

          if (annotation.volumes.length === 0) {
            throw new VolumeImportError(
              "The volume data could not be imported because this annotation does not contain an editable volume layer. To import an annotation that contains volume data, upload it via the dashboard to create a new annotation, or add a volume layer to this annotation first.",
            );
          }

          const oldVolumeTracing = getActiveSegmentationTracing(storeState);

          if (oldVolumeTracing == null) {
            throw new VolumeImportError(
              "The volume data could not be imported because no editable volume layer is active. Please make sure that an editable volume layer is visible and try again.",
            );
          }

          const newLargestSegmentId = await importVolumeTracing(
            annotation,
            oldVolumeTracing,
            dataFile,
            annotation.version,
          );

          Store.dispatch(importVolumeTracingAction());
          Store.dispatch(setVersionNumberAction(annotation.version + 1));
          Store.dispatch(setLargestSegmentIdAction(newLargestSegmentId));
          await clearCache(dataset, oldVolumeTracing.tracingId);
          await api.data.reloadBuckets(oldVolumeTracing.tracingId);
        }

        await reader.close();
        return nmlImportActions;
      } catch (error) {
        if (error instanceof NmlParseError || error instanceof VolumeImportError) {
          // These errors carry a helpful, user-facing message and should be shown to the
          // user instead of being replaced by the generic "could not be parsed" message.
          throw error;
        }
        // @ts-expect-error
        console.error(`Tried parsing file "${file.name}" as ZIP but failed. ${error.message}`);
        return undefined;
      }
    };

    const { successes: importActionsWithDatasetNames, errors } = await promiseAllWithErrors(
      files.map(async (file) => {
        const ext = (last(file.name.split(".")) || "").toLowerCase();

        let tryImportFunctions;
        if (ext === "nml" || ext === "xml")
          tryImportFunctions = [tryParsingFileAsNml, tryParsingFileAsProtobuf];
        else if (ext === "zip") tryImportFunctions = [tryParsingFileAsZip];
        else tryImportFunctions = [tryParsingFileAsProtobuf, tryParsingFileAsNml];

        /* eslint-disable no-await-in-loop */
        for (const importFunction of tryImportFunctions) {
          const maybeImportAction = await importFunction(file);

          if (maybeImportAction) {
            return maybeImportAction;
          }
        }

        /* eslint-enable no-await-in-loop */
        throw new Error(`"${file.name}" could not be parsed as NML, protobuf or ZIP.`);
      }),
    );

    if (errors.length > 0) {
      throw errors;
    }

    // Dispatch the actual actions as the very last step, so that
    // not a single store mutation happens if something above throws
    // an error
    importActionsWithDatasetNames
      .flatMap((el) => el.importActions)
      .forEach((action) => {
        Store.dispatch(action);
      });
  } catch (e) {
    (Array.isArray(e) ? e : [e]).forEach((err) => {
      Toast.error(err.message);
    });
  }
}
