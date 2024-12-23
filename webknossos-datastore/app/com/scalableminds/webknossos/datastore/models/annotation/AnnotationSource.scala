package com.scalableminds.webknossos.datastore.models.annotation

import play.api.libs.json.{Json, OFormat}

case class AnnotationSource(id: String,
                            annotationLayers: List[AnnotationLayer],
                            datasetDirectoryName: String,
                            organizationId: String,
                            dataStoreUrl: String,
                            tracingStoreUrl: String,
                            accessViaPrivateLink: Boolean) {
  def getAnnotationLayer(layerName: String): Option[AnnotationLayer] = annotationLayers.find(_.name == layerName)
}

object AnnotationSource {
  implicit val jsonFormat: OFormat[AnnotationSource] = Json.format[AnnotationSource]
}
