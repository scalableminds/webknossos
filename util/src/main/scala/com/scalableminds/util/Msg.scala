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
    }
    object Merge {
      val failed: String = "Could not merge annotations."
      val success: String = "Merging annotations was successful."
      val noAccessOnMerged: String = "Could not access merged annotation."
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
      val failed: String = "Failed to reopen the annotation."
      val success: String = "Annotation was reopened."
    }
    object Lock {
      val explorationalsOnly: String = "Only explorational annotations can be locked."
      val failed: String = "Changing the isLockedByOwner state of the annotation failed."
      val notAllowed: String =
        "Only the owner of this annotation is allowed to change the locked state of an annotation."
      val success: String = "The locking state of the annotation was successfully updated."
    }
    object Mutex {
      val acquireFailed: String = "Failed to acquire annotation editing mutex."
      val releaseFailed: String = "Failed to release annotation editing mutex."
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
    object Download {
      val failed: String = "Could not download annotation."
      val fetchVolumeLayerFailed: String = "Could not fetch volume annotation layer."
      val fetchSkeletonLayerFailed: String = "Could not fetch skeleton annotation layer."
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
    }
    object EditableMapping {
      val numEdgesExceedsInt: String = "Edge count for editable mapping exceeds int32 range."
    }
    object Upload {
      def zipFileNotFound: String = "Could not extract zipped data from upload request."
    }
    val notFound: String = "Annotation could not be found or accessed."
    val notFoundConsiderLogin: String =
      "Annotation could not be found or accessed. You may need to log in to see it."
    val cancelled: String = "This annotation is marked as cancelled and cannot be viewed."
    def invalidType(typ: String): String = s"The supplied annotation type “$typ” is not a valid annotation type."
    val publicWritesFailed: String = "Could not convert annotation to Json."
    val sandboxSkeletonOnly: String = "Sandbox annotations are currently available as skeleton only."
    val createFailed: String = "Could not create annotation."
    val finishFailed: String = "Could not finish/archive the annotation."
    val finished: String = "Annotation is archived."
    val allFinished: String = "All selected annotations were finished/archived."
    val updateNotAllowed: String = "You are not allowed to update this annotation."
    def reserveTooManyIds(limit: Int): String = s"Cannot reserve more than $limit ids in one request."
    val countListableFailed: String = "Could not count listable annotations."
    val duplicateFailed: String = "Could not duplicate annotation."
    val updateStateFailed: String = "Could not update state of annotation."
    val nameNotAvailable: String = "Could not determine name for annotation."
    def idForTracingFailed(tracingId: String): String = s"Could not determine annotation id for tracing id $tracingId."
  }
  object Organization {
    def notFound(id: String): String = s"Organization “$id” could not be found or accessed."
    def notFoundWrongHost(orgaId: String, gotHost: String, thisHost: String): String =
      s"Organization “$orgaId” could not be found or accessed. Please check whether you are on the correct WEBKNOSSOS instance. The uploaded file indicates “$gotHost” while this instance is “$thisHost”."
    object TermsOfService {
      def versionMismatch(requiredVersion: Int, version: Int): String =
        s"Terms of service version mismatch. Current version is $requiredVersion, received acceptance for $version."
      val notEnabled: String = "Cannot accept terms of service, as it is not configured for this WEBKNOSSOS instance."
    }
    object Create {
      val forbidden = "You are not allowed to create a new organization."
      val directoryCreationFailed = "Could not create organization directory on disk."
    }
    val pricingUpdatesOnlyAdmin =
      "You are not allowed to request any changes to your organization WEBKNOSSOS plan. Please contact an organization admin."
    val creditOrdersOnlyOwner =
      "You are not allowed to order WEBKNOSSOS credits for your organization. Please contact the organization owner."
    val creditOrdersNotPositive =
      "Cannot order a negative number of WEBKNOSSOS credits."
  }
  object DataStore {
    val notFound: String = "DataStore could not be found or accessed."
    val notFoundForDataset: String = "DataStore for dataset could not be found or accessed."
    def nameTaken(name: String): String = s"A dataStore named “$name” already exists. The name needs to be unique."
  }
  object TracingStore {
    val notFound: String = "TracingStore could not be found or accessed."
  }
  object ObjectId {
    def invalid(literal: String): String = s"The supplied resource id “$literal” is not a valid ObjectId."
  }
  object Job {
    object TrainModel {
      val wrongOrga: String = "Training AI models is only allowed for datasets of your own organization."
      val submitFailed: String = "Submitting the AI Model Training job failed."
    }
    object Inference {
      val wrongOrga: String = "Running AI models is only allowed for datasets of your own organization."
      val submitFailed: String = "Submitting the AI Inference job failed."
    }
    val exportFileNotFound: String = "Exported file not found. The link may be expired."
  }
  object Dataset {
    val noBoundingBox: String = "This dataset has no bounding box. Please make sure this dataset is imported correctly."
    def notFound(name: String): String = s"Dataset with name “$name” could not be found or accessed."
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
    def publicWritesFailed(id: ObjectId): String = s"Could not write Json for dataset “$id”."
    def noData = "Could not load data for the requested dataset."
    def bucketCountMismatch = "Bucket count mismatch while loading multiple data buckets for dataset."
    object DataSource {
      val notFound: String = "Datasource not found on datastore server. Might still be initializing."
      val alreadyPresent: String = "A datasource-properties.json file already exists at the target location."
      val updateFileFailed: String = "Could not update datasource-properties.json file."
    }
    object Layer {
      def notFound(layerName: String): String = s"Could not find layer “$layerName” in dataset."
      def invalidMag(mag: String): String = s"Supplied “$mag” is not a valid mag format. Please use “x-y-z”."
      def wrongMag(layer: String, mag: String): String = s"Data layer “$layer” does not have mag “$mag”."
      def wrongAttachment(layer: String, attachment: String): String =
        s"Data layer “$layer” does not have attachment “$attachment”."
    }
    object Metadata {
      val duplicateKeys: String = "Metadata keys must be unique."
    }
    object Histogram {
      def failed(layerName: String): String = s"Could not generate histogram data for layer “$layerName”."
      def layerMissing(layerName: String): String = s"Could not generate histogram data: missing layer “$layerName”."
    }
    object Upload {
      def finishFailed(datasetId: ObjectId): String = s"Could not finalize upload for dataset “$datasetId”."
      def noSuchUpload(uploadId: String): String = s"Could not find running upload with upload id “$uploadId”."
    }
    object Chunk {
      def decompressFailed: String = "Could not decompress data chunk."
    }
  }
  object Task {
    def notFound: String = s"Task could not be found or accessed."
    def notFound(id: ObjectId): String = s"Task “$id” could not be found or accessed."
    val findAnnotationsFailed: String = "Failed to retrieve annotations for this task."
    val cancelled: String = "Task is finished."
    val unavailable: String = "There is currently no task available."
    val tooManyOpenOnes: String = "You already have too many open tasks."
    val deleteSuccess = "Task was deleted."
    val deleteFailure = "Could not delete task."
    def editSuccess = "Task was successfully updated."
    def assigned = "You got a new task."
    object Create {
      def batchLimitExceeded(limit: Int): String = s"Cannot create more than $limit tasks in one request."
      val needsEitherSkeletonOrVolume: String = "Each task needs to either be skeleton or volume."
    }
  }
  object Project {
    def notFound: String = s"Project could not be found or accessed."
    def notFound(id: ObjectId): String = s"Project “$id” could not be found or accessed."
    def deleteSuccess(id: ObjectId) = s"Project “id” was successfully deleted."
    def nameTaken(name: String) =
      s"A project named “$name” already exists. The name needs to be unique."
  }
  object Nml {
    val uploadSuccess: String = "Successfully uploaded file."
    val differentDatasets: String = "Cannot upload annotations that belong to different datasets at once."
    def parseFailure(fileName: String, error: String): String = s"Could not parse file “$fileName”: $error"
    def parametersNotFound = "No parameters section found."
    def duplicateVolumeLayerNames = "Annotations with multiple volume layers must have a unique name for each layer."
    def invalidElements(name: String) = s"Invalid $name elements."
    def invalidTreeElements(name: String, treeId: Int) = s"Invalid $name in tree $treeId."
    def invalidTreeGroupId(id: String) = s"Invalid tree group id “$id”."
    def invalidSegmentGroupId(id: String) = s"Invalid segment group id “$id”."
    def invalidUserBboxId(id: String) = s"Invalid user bounding box id “$id”"
    def invalidTreeId(id: String) = s"Invalid tree id “$id”."
    def additionalCoordinatesNotUnique = "Additional coordinates do not have unique names."
    def invalidNodeId(label: String, id: String) = s"Invalid$label node id “$id”."
    def invalidNodeIdInComment(nodeId: String) = s"Invalid node id “$nodeId” in comment."
    def invalidEdge(src: String, dst: String) = s"Invalid edge “$src-$dst”."
    def invalidNodeAttribute(name: String, id: Int) = s"Invalid node $name for node id $id"
  }
  object TaskType {
    def notFound(id: ObjectId): String = s"Task type “$id” could not be found or accessed."
    def summaryTaken(summary: String): String =
      s"A task type with summary “$summary” already exists. The summary needs to be unique."
    def editSuccess = "Task type was successfully updated."
    def deleteSuccess(summary: String) = s"Task type “$summary” was successfully deleted."
    def deleteFailed(summary: String) = s"Could not delete task type “$summary”."
  }
  object User {
    def notFound: String = s"User could not be found or accessed."
    def notFound(id: ObjectId): String = s"User “$id” could not be found or accessed."
    val noSelfDeactivate: String = "You cannot deactivate yourself. Please contact an admin to do it for you."
    val notAuthenticated: String = "You are not authorized to view this resource. Please log in."
    val emailAalreadyInUse: String = "This email address is already in use."
    val passwordsDontMatch: String = "The two passwords do not match."
    val isDeactivated: String =
      s"Your account has not been activated by an admin yet. Please contact your organization’s admin for help."
    val invalidCredentials: String = "Incorrect email or password. Please try again."
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
  }
  object Team {
    def notFound(id: ObjectId): String = s"Team “$id” could not be found or accessed."
    def inUseByProjects(count: Int): String = s"Team is referenced by $count projects."
    def inUseByTaskTypes(count: Int): String = s"Team is referenced by $count task types."
    def inUseByAnnotations(count: Int): String = s"Team is referenced by $count annotations."
    def adminNotPossibleBy(teamName: String, userName: String) =
      s"User “$userName” cannot be assigned administrative rights in team “$teamName” because they are not in the same organization."
    def deleteSuccess = "Team was deleted."
    def createSuccess = "Team was successfully created."
  }
  object Mesh {
    object File {
      def readVersionFailed(name: String): String = s"Failed to read format version from file “$name”."
      def readMappingNameFailed(name: String): String = s"Failed to read mapping name from mesh file “$name”."
      def lookUpFailed(name: String): String = s"Failed to look up mesh file “$name”."
      def listChunksFailed(segmentIds: String, name: String) =
        s"Failed to load chunk list for segment $segmentIds from mesh file “$name”."
      def zeroChunks(segmentIds: String, name: String) =
        s"Zero mesh chunks for segment $segmentIds in mesh file “$name”."
    }
  }
  object ConnectomeFile {
    def lookUpFailed(name: String): String = s"Failed to look up connectome file “$name”."
    def readMappingNameFailed(name: String): String = s"Failed to read mapping name from connectome file “$name”."
  }
  object Zarr {
    def invalidChunkCoordinates(coordinates: String): String =
      s"Invalid chunk coordinates $coordinates. Expected dot separated coordinates like c.<additional_axes.>x.y.z"
  }
  object DataVault {
    def setupFailed: String = "Could not set up remote file system access."
  }
  val notAllowed: String = "You are not authorized to view or edit this resource."
  val notFound: String = "Couldn’t find or access the requested resource."
  val invalidJson: String = "Invalid Json format."
}
