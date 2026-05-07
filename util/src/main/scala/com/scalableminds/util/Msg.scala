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
        s"The largest segment id $id specified for the annotation layer exceeds the range of its data type $ec"
    }
    val notFound: String = "Annotation could not be found or accessed."
    val notFoundConsiderLoggingIn: String =
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
  }
  object Organization {
    def notFound(id: String): String = s"Organization “$id” could not be found or accessed."
    def notFoundWrongHost(orgaId: String, gotHost: String, thisHost: String): String =
      s"Organization “$orgaId” could not be found or accessed. Please check whether you are on the correct WEBKNOSSOS instance. The uploaded file indicates “$gotHost” while this instance is “$thisHost”."
  }
  object DataStore {
    val notFound: String = "Data store could not be found or accessed."
    val notFoundForDataset: String = "Data store for dataset could not be found or accessed."
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
  }
  object Dataset {
    val noBoundingBox: String = "This dataset has no bounding box. Please make sure this dataset is imported correctly."
    def notFound(id: ObjectId): String = s"Dataset “$id” could not be found or accessed."
    def notFoundforAnnotation(datasetId: ObjectId, annotationId: ObjectId): String =
      s"Dataset “$datasetId” for annotation “$annotationId” does not exist or could not be accessed."
    def notFoundWrongHost(datasetId: ObjectId, gotHost: String, thisHost: String): String =
      s"Dataset “$datasetId” could not be found or accessed. Please check whether you are on the correct WEBKNOSSOS instance. The uploaded file indicates “$gotHost” while this instance is “$thisHost”."
    def notUsable(id: ObjectId): String = s"Dataset “$id” is not imported or incomplete."
    object DataSource {
      val notFound: String = "Datasource not found on datastore server. Might still be initializing."
    }
    object Layer {
      def notFound(layerName: String): String = s"Could not find layer “$layerName” in dataset."
    }
  }
  object Task {
    def notFound: String = s"Task could not be found or accessed."
    def notFound(id: ObjectId): String = s"Task “$id” could not be found or accessed."
    val findAnnotationsFailed: String = "Failed to retrieve annotations for this task."
    val cancelled: String = "Task is finished."
    val unavailable: String = "There is currently no task available."
    object Create {
      def batchLimitExceeded(limit: Int): String = s"Cannot create more than $limit tasks in one request."
      val needsEitherSkeletonOrVolume: String = "Each task needs to either be skeleton or volume."
    }
  }
  object Project {
    def notFound: String = s"Project could not be found or accessed."
    def notFound(id: ObjectId): String = s"Project “$id” could not be found or accessed."
  }
  object Nml {
    val uploadSuccess: String = "Successfully uploaded file."
    val differentDatasets: String = "Cannot upload annotations that belong to different datasets at once."
    def parseFailure(fileName: String, error: String): String = s"Could not parse file “$fileName”: $error"
  }
  object TaskType {
    def notFound(id: ObjectId): String = s"Task type “$id” could not be found or accessed."
  }
  object User {
    def notFound: String = s"User could not be found or accessed."
    def notFound(id: ObjectId): String = s"User “$id” could not be found or accessed."
    val noSelfDeactivate: String = "You cannot deactivate yourself. Please contact an admin to do it for you."
    val notAuthenticated: String = "You are not authorized to view this resource. Please log in."
  }
  object Team {
    def notFound(id: ObjectId): String = s"Team “$id” could not be found or accessed."
  }
  val notAllowed: String = "You are not authorized to view or edit this resource."
}
