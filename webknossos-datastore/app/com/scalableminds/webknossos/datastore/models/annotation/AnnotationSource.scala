package com.scalableminds.webknossos.datastore.models.annotation

import com.scalableminds.util.objectid.ObjectId
import play.api.libs.json.{Json, OFormat}

case class AnnotationSource(id: ObjectId,
                            annotationLayers: List[AnnotationLayer],
                            datasetDirectoryName: String,
                            datasetId: ObjectId,
                            organizationId: String,
                            dataStoreUrl: String,
                            tracingStoreUrl: String,
                            accessViaPrivateLink: Boolean) {
  def getAnnotationLayer(layerName: String): Option[AnnotationLayer] = annotationLayers.find(_.name == layerName)
}

object AnnotationSource {
  implicit val jsonFormat: OFormat[AnnotationSource] = Json.format[AnnotationSource]
}
