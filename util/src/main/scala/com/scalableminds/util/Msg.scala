package com.scalableminds.util

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
    def notFound: String = "Annotation could not be found."
  }
  object Organization {
    def notFound(id: String) = s"Organization $id could not be found."
  }
  object DataStore {
    def notFound = "DataStore not found."
  }
  object ObjectId {
    def invalid(literal: String) = s"The passed resource id “$literal” is not a valid ObjectId."
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
  }
}
