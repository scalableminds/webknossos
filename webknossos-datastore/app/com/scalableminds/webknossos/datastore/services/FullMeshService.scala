package com.scalableminds.webknossos.datastore.services

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox

case class FullMeshRequest(
    meshSource: String,
    lod: Option[Int],
    segmentId: Long, // if mappingName is set, this is an agglomerate id
    mappingName: Option[String],
    mappingType: Option[String], // json, agglomerate, editableMapping
    mag: Option[Vec3Int],
    subsamplingStrides: Option[Vec3Int]
)

class FullMeshService @Inject()() {
  def loadFor(token: Option[String],
              organizationName: String,
              datasetName: String,
              dataLayerName: String,
              fullMeshRequest: FullMeshRequest): Fox[Array[Byte]] = ???
}
