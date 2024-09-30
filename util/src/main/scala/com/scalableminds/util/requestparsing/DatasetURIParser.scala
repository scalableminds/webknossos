package com.scalableminds.util.requestparsing

trait DatasetURIParser {

  def getDatasetIdOrNameFromURIPath(datasetNameAndId: String): (Option[ObjectId], Option[String]) = {
    val maybeIdStr = datasetNameAndId.split("-").lastOption
    val maybeId = maybeIdStr.flatMap(ObjectId.fromStringSync)
    maybeId match {
      case Some(validId) => (Some(validId), None)
      case None          => (None, Some(datasetNameAndId))
    }
  }

}
