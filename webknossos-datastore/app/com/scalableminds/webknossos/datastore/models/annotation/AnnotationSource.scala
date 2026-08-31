package com.scalableminds.webknossos.datastore.models.annotation

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.JsonAutoFormat

case class AnnotationSource(
    id: ObjectId,
    annotationLayers: List[AnnotationLayer],
    datasetDirectoryName: String,
    datasetId: ObjectId,
    organizationId: String,
    dataStoreUrl: String,
    tracingStoreUrl: String,
    accessViaPrivateLink: Boolean
) derives JsonAutoFormat {
  def getAnnotationLayer(layerName: String): Option[AnnotationLayer] = annotationLayers.find(_.name == layerName)
}
