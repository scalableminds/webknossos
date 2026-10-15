import { getLeftOverStorageBytes } from "admin/organization/pricing_plan_utils";
import type { UnfinishedUpload } from "admin/rest_api";
import type { Rule } from "antd/es/form";
import { isFileExtensionEqualTo } from "libs/utils";
import difference from "lodash-es/difference";
import messages from "messages";
import type { FileWithPath } from "react-dropzone";
import type { APIOrganization } from "types/api_types";
import { syncValidator } from "types/validation";

const IMAGE_EXTENSIONS = ["tif", "tiff", "jpg", "jpeg", "png", "czi", "dm3", "dm4", "nifti", "raw"];

function countFilesWithExtension(files: FileWithPath[], extensions: string | string[]) {
  return files.filter((file) => isFileExtensionEqualTo(file.path, extensions)).length;
}

export function getUploadFileRules({
  organization,
  isActiveUserAdmin,
  unfinishedUploadToContinue,
}: {
  organization: APIOrganization;
  isActiveUserAdmin: boolean;
  unfinishedUploadToContinue: UnfinishedUpload | null;
}): Rule[] {
  return [
    {
      required: true,
      message: messages["dataset.import.required.zipFile"],
    },
    {
      validator: syncValidator(
        (files: FileWithPath[]) => countFilesWithExtension(files, "zip") <= 1,
        "You cannot upload more than one archive.",
      ),
    },
    {
      validator: syncValidator(
        (files: FileWithPath[]) => countFilesWithExtension(files, ["tar", "rar", "gz"]) === 0,
        "Tar, tar.gz and rar archives are not supported currently. Please use zip archives.",
      ),
    },
    {
      validator: syncValidator(
        (files: FileWithPath[]) => countFilesWithExtension(files, ["ply", "stl", "obj"]) === 0,
        "PLY, STL and OBJ files are not supported. Please upload image files instead of 3D geometries.",
      ),
    },
    {
      validator: syncValidator(
        (files: FileWithPath[]) => countFilesWithExtension(files, "nml") === 0,
        "An NML file is an annotation of a dataset and not an independent dataset. Please upload the NML file into the Annotations page in the dashboard or into an open dataset.",
      ),
    },
    {
      validator: syncValidator(
        (files: FileWithPath[]) => countFilesWithExtension(files, "mrc") === 0,
        "MRC files are not supported currently.",
      ),
    },
    {
      validator: syncValidator((files: FileWithPath[]) => {
        const archiveCount = countFilesWithExtension(files, "zip");
        // Either there are no archives, or all files are archives
        return archiveCount === 0 || archiveCount === files.length;
      }, "Archives cannot be mixed with other files."),
    },
    {
      validator: syncValidator(
        (files: FileWithPath[]) =>
          getLeftOverStorageBytes(organization) >= files.reduce((sum, file) => sum + file.size, 0),
        `The selected files exceed the available storage of your organization. Please ${
          isActiveUserAdmin
            ? "use the organization management page to request more storage"
            : "ask your administrator to request more storage"
        }.`,
      ),
    },
    {
      validator: syncValidator(
        (files: FileWithPath[]) =>
          countFilesWithExtension(files, "wkw") === 0 ||
          countFilesWithExtension(files, IMAGE_EXTENSIONS) === 0,
        "WKW files should not be mixed with image files.",
      ),
    },
    {
      validator: syncValidator(
        (files: FileWithPath[]) => {
          if (unfinishedUploadToContinue?.filePaths == null) {
            return true;
          }
          const filePaths = files.map((file) => file.path || "");
          return (
            unfinishedUploadToContinue.filePaths.length === filePaths.length &&
            difference(unfinishedUploadToContinue.filePaths, filePaths).length === 0
          );
        },
        "The selected files do not match the files of the unfinished upload. Please select the same files as before." +
          (unfinishedUploadToContinue?.filePaths != null
            ? `The file names are: ${unfinishedUploadToContinue.filePaths.join(", ")}.`
            : ""),
      ),
    },
  ];
}
