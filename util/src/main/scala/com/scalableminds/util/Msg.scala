package com.scalableminds.util

import com.scalableminds.util.objectid.ObjectId

import scala.concurrent.duration.FiniteDuration
import scala.reflect.internal.annotations

object Msg {
  object AgglomerateGraph {
    val failed = "Could not look up an agglomerate graph for requested agglomerate."
  }
  object AgglomerateTree {
    val failed = "Could not generate agglomerate tree."
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
    val updatingFailed: String = "Could not update AI model’s name and comment."
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
    }
    object Lock {
      val explorationalsOnly: String = "Only explorational annotations can be locked."
      val failed: String = "Changing the isLockedByOwner state of the annotation failed."
      val notAllowed: String =
        "Only the owner of this annotation is allowed to change the locked state of an annotation."
      val success: String = "The locking state of the annotation was successfully updated."
    }
    val notFound: String = "Annotation could not be found or accessed."
    val notFoundConsiderLoggingIn = "Annotation could not be found or accessed. You may need to log in to see it."
    val cancelled: String = "This annotation is marked as cancelled and cannot be viewed."
    def invalidType(typ: String) = s"The supplied annotation type “$typ” is not a valid annotation type."
    val publicWritesFailed: String = "Could not convert annotation to Json."
    val sandboxSkeletonOnly: String = "Sandbox annotations are currently available as skeleton only."
    val createFailed: String = "Could not create annotation."
    val finishFailed: String = "Could not finish/archive the annotation."
    val allFinished: String = "All selected annotations were finished/archived."
  }
  object Organization {
    def notFound(id: String) = s"Organization $id could not be found."
  }
  object DataStore {
    def notFound = "DataStore could not be found."
  }
  object ObjectId {
    def invalid(literal: String) = s"The supplied resource id “$literal” is not a valid ObjectId."
  }
  object Job {
    object TrainModel {
      def wrongOrga: String = "Training AI models is only allowed for datasets of your own organization."
      def submitFailed: String = "Submitting the AI Model Training job failed."
    }
    object Inference {
      def wrongOrga: String = "Running AI models is only allowed for datasets of your own organization."
      def submitFailed: String = "Submitting the AI Inference job failed."
    }
  }
  object Dataset {
    def noBoundingBox: String = "This dataset has no bounding box. Please make sure this dataset is imported correctly."
    def notFound(id: ObjectId) = s"Dataset “$id” could not be found or accessed."
  }
}
