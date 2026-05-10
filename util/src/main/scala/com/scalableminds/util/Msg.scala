package com.scalableminds.util

import com.scalableminds.util.objectid.ObjectId

import scala.concurrent.duration.FiniteDuration

object Msg {
  object AgglomerateGraph {
    val failed: String = "Could not look up an agglomerate graph for requested agglomerate."
  }
  object AgglomerateTree {
    val failed: String = "Could not generate agglomerate tree."
  }
  object AiInference {
    val notFound: String = "Could not find requested AI inference."
  }
  object AiModel {
    object FinishUpload {
      val notPending: String = "Cannot finish upload to path for AI model that is not currently marked as pending."
      val wrongOrga: String = "Cannot finish upload to path for AI models of other organizations."
    }
    object Delete {
      val referencedByInferences: String = "Cannot delete AI models that are referenced by existing inferences."
    }
    object Reserve {
      val notPending: String = "Cannot reserve upload to path for AI model that is not currently marked as pending."
      val wrongOrga: String = "Cannot publish AI model to a different organization than it was not reserved for."
    }
    object Training {
      val zeroAnnotations: String = "Need at least one training annotation for model training."
    }
    val dataStoreMismatch: String = "Cannot use AI model on a dataset on a different data store."
    def nameInUse(name: String): String =
      s"An AI model with the name “$name” already exists in this organization. Please chose a different name"
    val notFound: String = "Could not find requested AI model."
    val updatingFailed: String = "Could not update AI model's name and comment."
    val updatingSharedFailed: String = "Could not update the organizations that may access the AI model."
    val notOwned: String = "Only the owner of the AI model can perform this change."
  }
  object Annotation {
    object Restrictions {
      val notFound: String = "Could not check annotation access."
      val failedToCheck: String = "Could not check access restrictions."
    }
    object Merge {
      val failed: String = "Could not merge annotations."
      val success: String = "Merging annotations was successful."
      val noAccessOnMerged: String = "Could not access merged annotation."
      val failedCompound: String = "Couldn't merge annotations for compound view"
    }
    object Reset {
      val failed: String = "Could not reset annotation to base state."
      val success: String = "Annotation was successfully reset."
    }
    object Reopen {
      val notFinished: String = "The requested annotation is not finished or archived, so it cannot be reopened."
      val notAllowed: String = "You are not allowed to reopen this annotation."
      def tooLate(duration: FiniteDuration): String =
        s"The annotation cannot be reopened anymore, since it has been finished for too long (configured as $duration)."
      val failed: String = "Could not reopen the annotation."
      val success: String = "Annotation was reopened."
    }
    object Lock {
      val explorationalsOnly: String = "Only explorational annotations can be locked."
      val failed: String = "Could not change the isLockedByOwner state of the annotation."
      val notAllowed: String =
        "Only the owner of this annotation is allowed to change the locked state of an annotation."
      val success: String = "The locking state of the annotation was successfully updated."
    }
    object Mutex {
      val acquireFailed: String = "Could not acquire annotation editing mutex."
      val releaseFailed: String = "Could not release annotation editing mutex."
    }
    object CollaborationMode {
      val onlyExplorationalOrTask: String =
        "Changing the collaboration mode is only allowed for explorational and task annotations."
    }
    object Edit {
      val failed: String = "Could not update the annotation."
      val success: String = "Successfully updated the annotation."
      val accessingTeamFailed: String = "Could not access a team during annotation shared team update."
    }
    object Update {
      val updateGroupVersionsNotSortedDesc: String =
        "Annotation update group versions are not sorted in descending order."
      val prefillBucketBufferFailed: String = "Could not prefill bucket buffer for annotation update."
    }
    object Download {
      val failed: String = "Could not download annotation."
      val fetchVolumeLayerFailed: String = "Could not fetch volume annotation layer."
      val fetchSkeletonLayerFailed: String = "Could not fetch skeleton annotation layer."
      val fetchNotSkeleton: String = "Cannot fetch skeleton annotation: not a skeleton layer"
      val fetchTypeMismatch: String = "Type mismatch when fetching annotation layer for download."
      val multipleSkeletons: String = "Cannot download annotation with multiple skeleton layers"
      val volumeNameForMultiple: String = "Cannot download multiple volume layers if volume name is passed"
      val findUserFailed: String = "Could not find or access annotation user."
      val zipNmlFailed: String = "Could not add NML file to zip archive."
      val skeletonToFileFailed: String = "Could not write skeleton-only annotation to file."
      val hybridToFileFailed: String = "Could not write annotation with volume layer to file."
      val notAllowed: String = "You are not allowed to download this annotation."
      val writeToFileFailed: String = "Could not write annotation to temporary file for download."
    }
    object Volume {
      def largestSegmentIdExceedsRange(id: Long, ec: String): String =
        s"The largest segment id $id specified for the annotation layer exceeds the range of its data type “$ec”"
      def wrongMag(tracingId: String, mag: String): String =
        s"Annotation layer “$tracingId” does not have mag “$mag”."
      val fallbackDataSplitFailed: String =
        "Could not split flat fallback layer bucket data from datastore into buckets."
      val fallbackDataLengthMismatch: String =
        "Length mismatch when unpacking bucket data from datastore for fallback layer."
      val mergedVolumeStatsNotFound: String =
        "Could not find mergedVolumeStats from previous merge steps."
      val invalidLargestSegmentId: String =
        "Cannot create tasks with fallback segmentation layers that do not have a valid largest segment id."
      val magRestrictionsTooTight: String =
        "Task type mag restrictions are too tight, resulting annotation has no magnifications."
      val mergeLargestSegmentIdUnset: String =
        "Cannot merge volume annotation: largest segment id is not set."
      val noEditableMapping: String =
        "This volume tracing does not have an editable mapping (not a “proofreading” annotation layer)"
    }
    object EditableMapping {
      val numEdgesExceedsInt: String = "Edge count for editable mapping exceeds int32 range."
      val getAgglomerateGraphFailed: String =
        "Could not look up an agglomerate graph for requested agglomerate."
      val getAgglomerateIdsForSegmentsFailed: String =
        "Could not look up agglomerate ids for requested segments."
      val getAgglomerateTreeEmpty: String =
        "The requested agglomerate was empty. It was likely merged into another agglomerate already."
    }
    object AddLayer {
      val nameInUse: String =
        "An annotation layer with this name already exists in this annotation. Please change it to prevent duplicates."
      val onlyOneSkeletonAllowed: String = "Only one skeleton layer is allowed per annotation."
    }
    object ApplyUpdate {
      val addEditableMappingFailed: String = "Could not add editable mapping during annotation update."
      val addLayerFailed: String = "Could not add layer during annotation update."
      val editableMappingActionFailed: String =
        "Could not apply editable mapping action during annotation update."
      val resetToBaseFailed: String = "Could not reset to base during annotation update."
      val revertToVersionFailed: String = "Could not revert to version during annotation update."
      val skeletonActionFailed: String = "Could not apply skeleton action during annotation update."
      val volumeActionFailed: String = "Could not apply volume action during annotation update."
    }
    object ApplyUpdates {
      val failed: String = "Could not apply annotation updates."
      val innerFailed: String = "Could not apply inner annotation updates."
    }
    object Revert {
      val failed: String = "Could not revert the annotation."
      val tasksOnly: String = "Reverting an annotation is only implemented for tasks"
    }
    object Upload {
      def zipFileNotFound: String = "Could not extract zipped data from upload request."
    }
    object TSRevert {
      val editableMappingDataFailed: String = "Could not revert editable mapping data."
      val getSourceFailed: String = "Could not get source version for annotation revert."
      val revertDistributedElementsFailed: String = "Could not revert distributed annotation elements."
      val volumeDataFailed: String = "Could not revert volume data."
    }
    val notFound: String = "Annotation could not be found or accessed."
    val notFoundConsiderLogin: String =
      "Annotation could not be found or accessed. You may need to log in to see it."
    val cancelled: String = "This annotation is marked as cancelled and cannot be viewed."
    def invalidType(typ: String): String = s"The supplied annotation type “$typ” is not a valid annotation type."
    val publicWritesFailed: String = "Could not convert annotation to Json."
    val sandboxSkeletonOnly: String = "Sandbox annotations are currently available as skeleton only."
    val createFailed: String = "Could not create annotation."
    val createForbidden: String = "You do not have permission to create annotations for this dataset."
    val createTracingsFailed: String = "Failed to set up annotation layers"
    val finishFailed: String = "Could not finish/archive the annotation."
    val finished: String = "Annotation is archived."
    val allFinished: String = "All selected annotations were finished/archived."
    val updateNotAllowed: String = "You are not allowed to update this annotation."
    def reserveTooManyIds(limit: Int): String = s"Cannot reserve more than $limit ids in one request."
    val countListableFailed: String = "Could not count listable annotations."
    val duplicateFailed: String = "Could not duplicate annotation."
    val updateStateFailed: String = "Could not update state of annotation."
    val nameNotAvailable: String = "Could not determine name for annotation."
    def idForTracingFailed(tracingId: String): String =
      s"Could not determine annotation id for tracing id $tracingId."
    val mappingIsLocked: String = "Cannot modify mapping in a locked annotation."
    val mergeVolumeFailed: String = "Could not merge volume tracings."
    val mergeVolumeDataFailed: String = "Could not merge volume data."
    val mismatchingSkeletonIdsAndTracings: String = "Annotation has mismatching skeleton ids and tracings."
    val mismatchingVolumeIdsAndTracings: String = "Annotation has mismatching volume ids and tracings."
    val multiLayersSkeletonNotImplemented: String =
      "This feature is not implemented for annotations with more than one skeleton layer"
    val multiLayersVolumeNotImplemented: String =
      "This feature is not implemented for annotations with more than one volume layer"
    val needsAtleastOne: String = "Annotation needs at least one layer."
    val needsEitherSkeletonOrVolume: String = "Annotation needs at least one of skeleton or volume"
    val transfereeNoDatasetAccess: String =
      "Cannot transfer annotation to a user who has no access to the dataset"
    val typesEmpty: String = "No annotation types specified."
    val volumeBucketsNotEmpty: String =
      "Cannot make mapping editable in an annotation with mutated volume data"
    val determineTargetVersionFailed: String = "Could not determine target version for annotation."
    val findEditableMappingsFailed: String = "Could not find editable mappings for annotation."
    val findPendingUpdatesFailed: String = "Could not find pending updates for annotation."
    val findSkeletonRawFailed: String = "Could not find raw skeleton tracing."
    val findTracingsFailed: String = "Could not find tracings for annotation."
    val findVolumeRawFailed: String = "Could not find raw volume tracing."
    val flushAnnotationInfoFailed: String = "Could not flush annotation info."
    val flushEditableMappingUpdaterBuffersFailed: String =
      "Could not flush editable mapping updater buffers."
    val flushUpdatedTracingsFailed: String = "Could not flush updated tracings."
    val getAnnotationFailed: String = "Could not retrieve annotation from tracingstore."
    val getEditableMappingFailed: String = "Could not retrieve editable mapping."
    val getEditableMappingInfoRawFailed: String = "Could not retrieve raw editable mapping info."
    val getNewestMaterializedFailed: String = "Could not find newest materialized annotation."
    val getWithTracingsFailed: String = "Could not retrieve annotation with tracings."
    val makeEditableNoBaseMapping: String = "Cannot make editable: no base mapping is set."
    val updateRemoteFailed: String = "Could not update remote annotation info."
  }
  object Auth {
    object Passkeys {
      val disabled: String = "Passkeys disabled."
      val requiresHttps: String = "Passkeys are only supported with HTTPS."
      val unauthorized: String = "Passkey Authentication Failed."
    }
    object Register {
      val needInvite: String =
        "Registration without invite is disabled for this WEBKNOSSOS instance."
    }
  }
  object Attachment {
    val notFound: String = "Could not find the requested attachment."
  }
  object Chunk {
    val createFromFillValueFailed: String = "Could not create chunk from fill value."
    val shortcutCreateFromFillValueFailed: String =
      "Could not create chunk from fill value (shortcut path)."
    val shortcutWrapAndTypeFailed: String = "Could not wrap and type chunk data (shortcut path)."
    val wrapAndTypeFailed: String = "Could not wrap and type chunk data."
  }
  object Organization {
    def notFound(id: String): String = s"Organization “$id” could not be found or accessed."
    def notFoundWrongHost(orgaId: String, gotHost: String, thisHost: String): String =
      s"Organization “$orgaId” could not be found or accessed. Please check whether you are on the correct WEBKNOSSOS instance. The uploaded file indicates “$gotHost” while this instance is “$thisHost”."
    object TermsOfService {
      def versionMismatch(requiredVersion: Int, version: Int): String =
        s"Terms of service version mismatch. Current version is $requiredVersion, received acceptance for $version."
      val notEnabled: String =
        "Cannot accept terms of service, as it is not configured for this WEBKNOSSOS instance."
      val onlyOrganizationOwner: String =
        "Only the organization owner can accept terms of service."
    }
    object Create {
      val forbidden: String = "You are not allowed to create a new organization."
      val directoryCreationFailed: String = "Could not create organization directory on disk."
      val failed: String = "Failed to create a new organization"
    }
    val pricingUpdatesOnlyAdmin: String =
      "You are not allowed to request any changes to your organization WEBKNOSSOS plan. Please contact an organization admin."
    val creditOrdersOnlyOwner: String =
      "You are not allowed to order WEBKNOSSOS credits for your organization. Please contact the organization owner."
    val creditOrdersNotPositive: String =
      "Cannot order a negative number of WEBKNOSSOS credits."
    val alreadyJoined: String =
      "Your account is already associated with the selected organization."
    val ambiguous: String =
      "Registration without invite is now allowed for instances with multiple organizations."
    val allowOrganizationCreationNotEnabled: String =
      "Organization creation is not enabled for this WEBKNOSSOS instance."
    val folderCreationFailed: String = "Could not create organization root folder."
    val idAlreadyInUse: String =
      "This id is already claimed by a different organization and not available anymore. Please choose a different id."
    val idInvalid: String =
      "This organization id contains illegal characters. Please only use letters and numbers."
    val listFailed: String = "Failed to retrieve list of organizations."
    val listCreditTransactionsOnlyAdmin: String =
      "Only organization admins can list credit transactions."
    val listPlanUpdatesOnlyAdmin: String = "Only organization admins can list plan updates."
    val notFoundByInvite: String = "Organization specified in the invite could not be found."
    val storageExceeded: String = "The storage quota of the organization is exceeded."
    val usersUserLimitReached: String =
      "Cannot add new user to this organization because it would exceed the organization's user limit. Please ask the organization owner to upgrade."
  }
  object Invite {
    val invalidToken: String = "This invite token is invalid."
  }
  object DataStore {
    val notFound: String = "DataStore could not be found or accessed."
    val notFoundForDataset: String = "DataStore for dataset could not be found or accessed."
    def nameTaken(name: String): String =
      s"A dataStore named “$name” already exists. The name needs to be unique."
    val ambiguous: String =
      "Multiple data stores referenced. Please use only one data store."
    val createFailed: String = "Failed to create DataStore."
    val listFailed: String = "Failed to retrieve list of data stores."
    val removeFailed: String = "The DataStore could not get removed."
    val uploadToPathsNotAllowed: String =
      "The datastore that holds the layers requested to be linked does not support dataset upload to paths"
  }
  object TracingStore {
    val notFound: String = "TracingStore could not be found or accessed."
    val createFailed: String = "Could not create or update tracing store entry."
    val listFailed: String = "Failed to retrieve list of tracing stores."
  }
  object ObjectId {
    def invalid(literal: String): String =
      s"The supplied resource id “$literal” is not a valid ObjectId."
  }
  object Oidc {
    val authenticationFailed: String =
      "Failed to register / log in via Single-Sign-On (SSO with OIDC)"
    val configurationInvalid: String = "OIDC configuration is invalid"
    val disabled: String = "OIDC is disabled"
    val getTokenFailed: String = "Could not get token from OIDC provider."
  }
  object Folder {
    val notFound: String = "Could not find the requested folder"
    val createFailed: String = "Could not create folder."
    val deleteNotEmptyChildren: String = "Cannot delete folders that still contain other folders"
    val deleteNotEmptyDatasets: String = "Cannot delete folders that still contain datasets"
    val deleteRoot: String = "Cannot delete the organization's root folder"
    val moveRoot: String = "Cannot move the organization's root folder"
    val moveSelf: String = "Cannot move a folder into itself"
    val nameMustNotContainSlash: String = "Folder names cannot contain forward slashes"
    val noWriteAccess: String = "No write access in this folder"
    val pathMustStartWithSlash: String = "Folder path must start with a slash."
    val pathMustStartAtOrganizationRootFolder: String =
      "Folder path must start at the organization's root folder."
    val updateNameFailed: String = "Failed to update the folder's name"
    val updateNotAllowed: String = "No write access on this folder"
    val updateTeamsFailed: String = "Failed to update the folder's allowed teams"
  }
  object Job {
    object TrainModel {
      val wrongOrga: String = "Training AI models is only allowed for datasets of your own organization."
      val submitFailed: String = "Could not submit the AI model training job."
    }
    object Inference {
      val wrongOrga: String = "Running AI models is only allowed for datasets of your own organization."
      val submitFailed: String = "Could not submit the AI inference job."
    }
    object CreditTransaction {
      val failed: String = "Failed to perform credit transaction"
      val noAiPlan: String = "Only organizations with an AI plan are allowed to start this job."
      val refundFailed: String = "Failed to perform credit transaction refund"
    }
    val alignSectionsNotAllowedOrganization: String =
      "Aligning sections is only allowed for datasets of your own organization."
    val cleanupFailed: String = "Could not clean up failed job."
    val couldNotRunApplyMergerMode: String =
      "Failed to start job to apply merger mode annotation."
    val couldNotRunComputeMeshFile: String = "Failed to start mesh file computation job."
    val couldNotRunCubing: String = "Failed to start WKW conversion job."
    val couldNotRunFindLargestSegmentId: String = "Could not start find largest segment id job."
    val couldNotRunRenderAnimation: String = "Could not start render animation job."
    val couldNotRunSegmentIndexFile: String =
      "Could not start segment index file computation job."
    val couldNotRunTiffExport: String = "Failed to start Tiff export job."
    val disabled: String =
      "Long-running jobs are not enabled for this WEBKNOSSOS instance."
    val edgeLengthExceeded: String =
      "An edge length of the selected bounding box is too large."
    val emailNotificationsDisabled: String =
      "Email notifications are not enabled for this job type."
    val exportFileNotFound: String = "Exported file not found. The link may be expired."
    val findLargestSegmentIdNotAllowedOrganization: String =
      "Finding the largest segment id is only allowed for datasets of your own organization."
    val inferMitochondriaNotAllowedOrganization: String =
      "Inferring mitochondria is only allowed for datasets of your own organization."
    val invalidBoundingBoxOrMag: String =
      "Either the selected bounding box could not be parsed (must be x,y,z,width,height,depth) or the mag is wrong or does not exist."
    val materializeVolumeAnnotationNotAllowedOrganization: String =
      "Materializing volume annotations is only allowed for datasets of your own organization."
    val meshFileNotAllowedOrganization: String =
      "Calculating mesh files is only allowed for datasets of your own organization."
    val noExportFileName: String = "Job does not have an export file name."
    val notEnoughCredits: String =
      "Your organization does not have enough WEBKNOSSOS credits to run this job."
    val notFound: String = "Job could not be found."
    val notRun: String = "Job has not run yet."
    val noWorkerForDatastoreAndJob: String =
      "No webknossos-worker supporting the requested job is available for the selected datastore."
    val paidNoAdminOrManager: String =
      "Starting paid jobs is only allowed for Administrators, Dataset Managers or Team Managers."
    val renderAnimationMustIncludeWatermark: String =
      "Render animation jobs must include the WEBKNOSSOS watermark."
    val renderAnimationResolutionMustBeSD: String =
      "Render animation jobs must use SD resolution."
    val segmentIndexFileNotAllowedOrganization: String =
      "Calculating segment index files is only allowed for datasets of your own organization."
    val updateStatusFailed: String = "Failed to update long-running job's status"
    val volumeExceeded: String = "The volume of the selected bounding box is too large."
    val workerNotFound: String = "Could not find this worker in the database."
  }
  object Dataset {
    val noBoundingBox: String =
      "This dataset has no bounding box. Please make sure this dataset is imported correctly."
    def notFound(name: String): String =
      s"Dataset with name “$name” could not be found or accessed."
    def notFound(id: ObjectId): String = s"Dataset “$id” could not be found or accessed."
    def notFoundforAnnotation(datasetId: ObjectId, annotationId: ObjectId): String =
      s"Dataset “$datasetId” for annotation “$annotationId” does not exist or could not be accessed."
    def notFoundConsiderLogin(id: ObjectId): String =
      s"Dataset “$id” could not be found or accessed. You may need to log in to see it."
    def notFoundConsiderLogin(name: String): String =
      s"Dataset with name “$name” could not be found or accessed. You may need to log in to see it."
    def notFoundWrongHost(datasetId: ObjectId, gotHost: String, thisHost: String): String =
      s"Dataset “$datasetId” could not be found or accessed. Please check whether you are on the correct WEBKNOSSOS instance. The uploaded file indicates “$gotHost” while this instance is “$thisHost”."
    def notUsable(id: ObjectId): String = s"Dataset “$id” is not imported or incomplete."
    val notUsableGeneric: String = "Dataset is not imported or incomplete."
    val notFoundForAnnotation: String =
      "The Dataset for this annotation does not exist or could not be accessed."
    def publicWritesFailed(id: ObjectId): String = s"Could not write Json for dataset “$id”."
    def noData: String = "Could not load data for the requested dataset."
    def bucketCountMismatch: String =
      "Bucket count mismatch while loading multiple data buckets for dataset."
    object Compose {
      val failed: String = "Could not compose dataset."
      val addAttachmentFailed: String = "Could not add attachment to composed dataset."
      val addLayerFailed: String = "Could not add layer to composed dataset."
      val addMagFailed: String = "Could not add mag to composed dataset."
      val inPlaceMustBeVirtual: String =
        "This feature is not available for disk-based (\"non-virtual\") datasets. If you have access on disk, edit it directly."
      val differingDataStores: String =
        "Cannot compose dataset from layers on different data stores."
      val duplicateMag: String = "Cannot compose dataset: duplicate mag in resulting layer."
    }
    object DataSource {
      val notFound: String = "Datasource not found on datastore server. Might still be initializing."
      val alreadyPresent: String =
        "A datasource-properties.json file already exists at the target location."
      val updateFileFailed: String = "Could not update datasource-properties.json file."
      val addPathsNotAllowed: String =
        "Cannot directly add a datasource with local paths that leave the dataset, or with paths that match the WEBKNOSSOS reserved paths."
    }
    object Delete {
      val disabled: String = "Dataset deletion is disabled for this WEBKNOSSOS instance"
      val failed: String = "Could not delete the dataset on disk."
      val webknossosFailed: String = "Could not delete dataset from WEBKNOSSOS database"
    }
    object Explore {
      val failed: String = "Could not explore remote dataset."
      val autoAddFailed: String = "Failed to automatically import the explored dataset."
      val autoAddGetFolderFailed: String =
        "Could not get or create folder during dataset exploration."
      val zeroLayers: String = "Explored dataset has no layers."
    }
    object InitialTeams {
      val invalidTeams: String = "Can only assign teams of user"
      val teamsNotEmpty: String = "Dataset already has allowed teams"
      val forbidden: String = "No access to update dataset teams."
    }
    object Layer {
      def notFound(layerName: String): String = s"Could not find layer “$layerName” in dataset."
      def invalidMag(mag: String): String =
        s"Supplied “$mag” is not a valid mag format. Please use “x-y-z”."
      def wrongMag(layer: String, mag: String): String =
        s"Data layer “$layer” does not have mag “$mag”."
      def wrongAttachment(layer: String, attachment: String): String =
        s"Data layer “$layer” does not have attachment “$attachment”."
    }
    object LayerToLink {
      val failed: String = "Could not resolve layers to link."
      val layerNotFound: String = "Could not find layer to link."
    }
    object List {
      val failed: String = "Failed to retrieve list of datasets."
      val dataStoreWritesFailed: String =
        "Could not write data store information for dataset list."
      val fetchAllowedTeamsFailed: String = "Could not fetch allowed teams for dataset list."
      val fetchDataSourceFailed: String = "Could not fetch data source for dataset."
      val fetchFailed: String = "Could not retrieve dataset list."
      val fetchLastUsedTimeFailed: String = "Could not fetch last used time for dataset."
      val fetchLogoUrlFailed: String = "Could not fetch logo URL for dataset."
      val groupingFailed: String = "Failed group retrieved datasets."
      val isEditableCheckFailed: String = "Could not check if dataset is editable."
      val teamWritesFailed: String = "Could not write team information for dataset list."
    }
    object Metadata {
      val duplicateKeys: String = "Metadata keys must be unique."
    }
    object Histogram {
      def failed(layerName: String): String =
        s"Could not generate histogram data for layer “$layerName”."
      def layerMissing(layerName: String): String =
        s"Could not generate histogram data: missing layer “$layerName”."
    }
    object Name {
      val alreadyTaken: String =
        "This name is already being used by a different dataset. Please choose a different name."
      val invalidCharacters: String =
        "Dataset name is invalid. Please use only letters, digits, dots, underscores, hyphens."
      val invalidLessThanThreeCharacters: String =
        "Dataset name is invalid. Please use at least three characters."
      val invalidStartsWithDot: String =
        "Dataset name is invalid. Please use a name that does not start with a dot."
      val taken: String = "This dataset name is already taken."
    }
    object ReserveMagUpload {
      val notVirtual: String =
        "Adding mags to existing datasets is only allowed for virtual datasets."
    }
    object Source {
      val usableButNoVoxelSize: String =
        "Dataset is marked as usable but has no voxel size."
    }
    object Upload {
      def finishFailed(datasetId: ObjectId): String =
        s"Could not finalize upload for dataset “$datasetId”."
      def noSuchUpload(uploadId: String): String =
        s"Could not find running upload with upload id “$uploadId”."
      val allChunksUploadedCheckFailed: String =
        "Could not verify that all chunks have been uploaded."
      val couldNotLoadUnfinishedUploads: String = "Could not load unfinished uploads of user."
      val creationFailed: String = "Failed to create dataset."
      val datastoreRestricted: String =
        "Your organization is not allowed to upload datasets to this datastore. Please choose another datastore."
      val disallowedPaths: String =
        "Cannot upload a datasource with local paths that leave the dataset, or with paths that match the WEBKNOSSOS reserved paths."
      val fileSizeCheckFailed: String = "File size check failed during dataset upload."
      val invalidLinkedLayers: String = "Could not link all requested layers"
      val linkRestricted: String =
        "Can only link layers of datasets that are either public or allowed to be administrated by your account"
      val measureTotalSizeFailed: String = "Could not measure total size of uploaded dataset."
      val moveToTargetFailed: String = "Failed to move uploaded dataset to target directory."
      val moveUnpackedToTargetFailed: String =
        "Could not move unpacked dataset to target directory."
      val needsConversionMissingVoxelSize: String =
        "Dataset needs conversion but voxel size is missing."
      val noFiles: String =
        "Tried to finish upload with no files. Note that files starting with dot are not read. This may be a retry of a failed finish request, see previous errors."
      val noLayers: String = "Cannot reserve upload for dataset with no layers."
      val reportUploadFailed: String = "Could not report upload completion to datastore."
      val storageExceeded: String =
        "Cannot upload dataset because the storage quota of the organization is exceeded."
      val uploaderNotEmpty: String = "Dataset already has non-empty uploader"
      val validationFailed: String = "Failed to validate Dataset information for upload."
    }
    object Chunk {
      def decompressFailed: String = "Could not decompress data chunk."
    }
    val duplicateLayerNames: String = "Dataset layers must have unique names."
    val layerMustBeSegmentation: String = "Data layer must be a segmentation layer."
    val layerNameAlreadyExists: String = "A layer with this name already exists in the dataset."
    val layerNameInvalidCharacters: String = "Layer name contains invalid characters."
    val layerNameInvalidStartsWithDot: String = "Layer name must not start with a dot."
    val loadingDataFailed: String = "Could not load data for dataset."
    val noLayers: String = "Dataset has no data layers."
    val noMags: String = "Data layer does not contain mags"
    val uploaderForbidden: String = "No permission to set uploader for this dataset."
  }
  object Layer {
    val notFound: String = "Could not find the requested data layer."
  }
  object Mag {
    val neededForAdHoc: String = "A mag needs to be provided for ad-hoc mesh computation."
    val notFound: String = "Could not find the requested mag."
    val notPresentInTracing: String =
      "The requested mag is not present in the volume tracing."
    val malformed: String = "Malformed mag format. Please use \"x-y-z\"."
    val restrictionsTooTight: String =
      "Mag restrictions are too tight. No valid magnification remains."
  }
  object Task {
    def notFound: String = s"Task could not be found or accessed."
    def notFound(id: ObjectId): String = s"Task “$id” could not be found or accessed."
    val findAnnotationsFailed: String = "Could not retrieve annotations for this task."
    val cancelled: String = "Task is finished."
    val unavailable: String = "There is currently no task available."
    val tooManyOpenOnes: String = "You already have too many open tasks."
    val deleteSuccess: String = "Task was deleted."
    val deleteFailure: String = "Could not delete task."
    val noAnnotations: String = "Could not find finished annotations for this task"
    def editSuccess: String = "Task was successfully updated."
    def assigned: String = "You got a new task."
    object Create {
      def batchLimitExceeded(limit: Int): String =
        s"Cannot create more than $limit tasks in one request."
      val needsEitherSkeletonOrVolume: String = "Each task needs to either be skeleton or volume."
      val failed: String = "Failed to create Task"
      val noTasks: String = "Zero tasks were requested"
      val notOnSameDataset: String = "Cannot create tasks on multiple datasets in one go."
      val notOnSameTaskType: String =
        "Cannot create tasks with differing task types in one go."
      val datasetOfOtherOrga: String =
        "Cannot create tasks for datasets of other organizations."
      val saveSkeletonFailed: String = "Could not save skeleton tracing for new task."
      val saveVolumeFailed: String = "Could not save volume tracing for new task."
    }
  }
  object Project {
    def notFound: String = s"Project could not be found or accessed."
    def notFound(id: ObjectId): String = s"Project “$id” could not be found or accessed."
    def notFound(name: String): String =
      s"Project with name “$name” could not be found or accessed."
    def deleteSuccess(id: ObjectId): String = s"Project “$id” was successfully deleted."
    def nameTaken(name: String): String =
      s"A project named “$name” already exists. The name needs to be unique."
    val creationFailed: String = "Failed to create project."
    val increaseTaskInstancesNegative: String =
      "Cannot increment task counts by negative number"
    val listFailed: String = "Failed to retrieve list of projects."
    val noAnnotations: String = "Could not find annotations for this project"
    val removeFailed: String = "Project could not be removed"
    val removeNotAllowed: String =
      "You are not authorized to remove this project. Talk to the project owner."
    val updateFailed: String = "Project update failed"
  }
  object Script {
    def notFound(id: ObjectId): String = s"Script “$id” could not be found or accessed."
    def nameInvalidChars(name: String): String =
      s"Script name “$name” is invalid. Please use only letters, digits, dots, space, underscores, hyphens."
    val notFound: String = "Script could not be found"
    val notOwner: String = "You are not the owner of the script you want to edit."
    val removalFailed: String = "Failed to remove script"
    val writeFailed: String = "Failed to convert script to json"
  }
  object Nml {
    val uploadSuccess: String = "Successfully uploaded file."
    val differentDatasets: String =
      "Cannot upload annotations that belong to different datasets at once."
    val fileNotFound: String = "Could not extract NML file"
    def parseFailure(fileName: String, error: String): String =
      s"Could not parse file “$fileName”: $error"
    def parametersNotFound: String = "No parameters section found."
    def duplicateVolumeLayerNames: String =
      "Annotations with multiple volume layers must have a unique name for each layer."
    def invalidElements(name: String): String = s"Invalid $name elements."
    def invalidTreeElements(name: String, treeId: Int): String =
      s"Invalid $name in tree $treeId."
    def invalidTreeGroupId(id: String): String = s"Invalid tree group id “$id”."
    def invalidSegmentGroupId(id: String): String = s"Invalid segment group id “$id”."
    def invalidUserBboxId(id: String): String = s"Invalid user bounding box id “$id”"
    def invalidTreeId(id: String): String = s"Invalid tree id “$id”."
    def additionalCoordinatesNotUnique: String =
      "Additional coordinates do not have unique names."
    def invalidNodeId(label: String, id: String): String = s"Invalid$label node id “$id”."
    def invalidNodeIdInComment(nodeId: String): String =
      s"Invalid node id “$nodeId” in comment."
    def invalidEdge(src: String, dst: String): String = s"Invalid edge “$src-$dst”."
    def invalidNodeAttribute(name: String, id: Int): String =
      s"Invalid node $name for node id $id"
  }
  object TaskType {
    def notFound(id: ObjectId): String = s"Task type “$id” could not be found or accessed."
    def summaryTaken(summary: String): String =
      s"A task type with summary “$summary” already exists. The summary needs to be unique."
    def editSuccess: String = "Task type was successfully updated."
    def deleteSuccess(summary: String): String = s"Task type “$summary” was successfully deleted."
    def deleteFailed(summary: String): String = s"Could not delete task type “$summary”."
    val magRestrictionsImmutable: String =
      "Mag restrictions of task types are immutable. Consider creating a new task type."
    val noAnnotations: String = "Could not find finished annotations for this task type"
    val notFound: String = "Selected task type does not exist"
    val tracingTypeImmutable: String =
      "Annotation types of task types are immutable. Consider creating a new task type."
  }
  object User {
    def notFound: String = s"User could not be found or accessed."
    def notFound(id: ObjectId): String = s"User “$id” could not be found or accessed."
    val noSelfDeactivate: String =
      "You cannot deactivate yourself. Please contact an admin to do it for you."
    val notAuthenticated: String =
      "You are not authorized to view this resource. Please log in."
    val emailAalreadyInUse: String = "This email address is already in use."
    val passwordsDontMatch: String = "The two passwords do not match."
    val isDeactivated: String =
      s"Your account has not been activated by an admin yet. Please contact your organization's admin for help."
    val invalidCredentials: String = "Incorrect email or password. Please try again."
    val creationFailed: String = "Failed to create user"
    val idNotFound: String = "Could not find a user id in the request."
    val lastAdmin: String =
      "This user is the last remaining admin in your organization. You cannot remove admin privileges from this account."
    val lastOwner: String =
      "Cannot deactivate the organization owner. Please talk to the WEBKNOSSOS team to transfer organization ownership."
    val noAdmin: String = "Access denied. Only admin users can execute this operation."
    val superUserOnly: String =
      "This feature is currently only available for superusers."
    val teamMembershipsFailed: String = "Failed to retrieve team memberships for user"
    object Token {
      val deleted: String = "Token was deleted."
      def invalid: String = "The supplied token is invalid."
    }
    object Configuration {
      val updateSuccess: String = "Your configuration was updated."
      val updateSuccessForDataset: String = "Dataset configuration was updated."
      def invalid: String = "Could not parse configuration."
      def invalidForDataset: String = "Could not parse dataset configuration."
    }
    object Email {
      val alreadyInUse: String = "This email address is already in use"
      val notVerified: String =
        "Your email address is not yet verified. A new verification email has been sent."
      object Verification {
        val emailDoesNotMatch: String =
          "This verification key is associated with a different email address."
        val keyInvalid: String = "Verification key is invalid."
        val keyUsed: String = "Verification key has already been used."
        val linkExpired: String = "The email verification link is expired."
      }
    }
  }
  object Team {
    def notFound(id: ObjectId): String = s"Team “$id” could not be found or accessed."
    def inUseByProjects(count: Int): String = s"Team is referenced by $count projects."
    def inUseByTaskTypes(count: Int): String = s"Team is referenced by $count task types."
    def inUseByAnnotations(count: Int): String = s"Team is referenced by $count annotations."
    def adminNotPossibleBy(teamName: String, userName: String): String =
      s"User “$userName” cannot be assigned administrative rights in team “$teamName” because they are not in the same organization."
    val deleteSuccess: String = "Team was deleted."
    def createSuccess: String = "Team was successfully created."
    val adminNotAllowed: String = "You are not authorized to administrate this team."
    val deleteInUse: String =
      "Team cannot be deleted as it is referenced in an at least one annotation, project or task type"
    val deleteOrganizationTeam: String =
      "This team cannot be deleted. Each organization requires at least one base team."
    val nameInUse: String =
      "This name is already assigned to a different team and not available anymore. Please choose a different name."
    val notFound: String = "Team could not be found."
  }
  object Mesh {
    object File {
      def readVersionFailed(name: String): String =
        s"Could not read format version from file “$name”."
      def readMappingNameFailed(name: String): String =
        s"Could not read mapping name from mesh file “$name”."
      def lookUpFailed(name: String): String = s"Could not look up mesh file “$name”."
      def listChunksFailed(segmentIds: String, name: String): String =
        s"Could not load chunk list for segment $segmentIds from mesh file “$name”."
      def zeroChunks(segmentIds: String, name: String): String =
        s"Zero mesh chunks for segment $segmentIds in mesh file “$name”."
      def loadChunkFailed: String = "Failed to load mesh chunk for segment."
    }
    object LoadFull {
      def failed: String = "Failed to load full segment mesh."
    }
    val meshFileNameRequired: String =
      "Trying to load mesh from mesh file, but mesh file name was not supplied."
  }
  object ConnectomeFile {
    def lookUpFailed(name: String): String = s"Could not look up connectome file “$name”."
    def readMappingNameFailed(name: String): String =
      s"Could not read mapping name from connectome file “$name”."
    def openFailed: String = "Could not open connectome file for reading."
    def readEncodingFailed(name: String): String =
      "Could not read encoding from connectome file “$name”."
  }
  object Zarr {
    def invalidChunkCoordinates(coordinates: String): String =
      s"Invalid chunk coordinates $coordinates. Expected dot separated coordinates like c.<additional_axes.>x.y.z"
    val invalidAdditionalCoordinates: String =
      "Invalid additional coordinates for this data layer."
    val invalidFirstChunkCoord: String = "First Channel must be 0"
    val notEnoughCoordinates: String =
      "Invalid number of chunk coordinates. Expected to get at least 3 dimensions and channel 0."
  }
  object SegmentAnything {
    val notEnabled: String = "AI based quick select is not enabled for this WEBKNOSSOS instance."
    val noUri: String = "No Uri for SAM server configured."
    val getDataFailed: String = "Failed to get image data to send to SAM server."
    val getMaskFailed: String = "Failed to get image mask from SAM server."
  }
  object DataVault {
    def setupFailed: String = "Could not set up remote file system access."
    def createCredentialFailed: String = "Could not set up remote file system credential."
    val credentialInsertFailed: String = "Could not store credential for remote file system access."
  }
  object Voxelytics {
    val disabled: String =
      "Voxelytics workflow reporting and logging are not enabled for this WEBKNOSSOS instance."
    val noTaskFound: String = "No tasks found"
    val noWorkflowFound: String = "No workflows found"
    val runNotFound: String = "Workflow runs not found"
    val workflowNotFound: String = "Workflow not found"
    val workflowUserMismatch: String = "Workflow run already exists by other user"
    val zeroRunWorkflow: String = "No run for this workflow found"
  }
  object Image {
    val createFailed: String = "Failed to create image"
    val pageFailed: String = "Could not get page from image sprite sheet."
  }
  object VolumeSegmentIndex {
    val updateFailed: String = "Could not update volume segment index."
    val updateAddBucketFailed: String = "Could not add bucket to volume segment index."
    val updateCollectSegmentIdsFailed: String =
      "Could not collect segment ids for volume segment index update."
    val updateGetPreviousBucketFailed: String =
      "Could not get previous bucket from volume segment index."
    val updateRemoveBucketFailed: String = "Could not remove bucket from volume segment index."
  }
  val allowedTeamsNotFound: String = "Could not find allowed teams for dataset."
  val binaryPayloadInvalid: String = "Could not parse payload"
  val createFailed: String = "Could not create the requested resource."
  val formatJsonMissing: String = "Missing format json"
  val getSegmentPositionFromAgglomerateFileFailed: String =
    "Could not get segment position from agglomerate file."
  val initialDataNotEnabled: String =
    "Initial Data Insertion is not enabled in the configuration of this wK instance"
  val invalidAnnotationState: String = "Invalid annotation state."
  val invalidAnnotationType: String = "Invalid annotation type."
  val invalidTeamId: String = "Invalid team id."
  val maintenanceNotFound: String = "Maintenance entry could not be found."
  val organizationsNotEmpty: String =
    "There are already organizations present in the database. Please refresh the db schema and try again"
  val publicationNotFound: String = "Publication could not be found."
  val shortLinkNotFound: String = "No shortlink with this key could be found"
  val unsupportedAnnotationType: String = "Unsupported annotation type."
  val updateFailed: String = "Could not update the requested resource."
  val uploadToPathsNoMatchingPrefix: String =
    "Could not determine a configured path prefix that matches the request."
  val voxelSizeFailedToFetch: String = "Could not fetch voxel size for annotation."
  val zipFileNotFound: String = "No or invalid ZIP file specified"
  val notAllowed: String = "You are not authorized to view or edit this resource."
  val notFound: String = "Couldn't find or access the requested resource."
  val invalidJson: String = "Invalid Json format."
  val externalPathDeletionServiceWrongKey: String =
    "Wrong key for external path deletion service."
  val fetchOldPrecedenceLayerNeedsAnnotationId: String =
    "Annotation id is required to fetch old precedence layer."
  val exploreDataStoreMustBeEqualForAll: String =
    "All layers must be on the same data store for exploration."
}
