package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.geometry.Vec3Double
import play.api.libs.json.{Json, OFormat}

case class ExploreRemoteLayerParameters(remoteUri: String,
                                        credentialId: Option[String],
                                        preferredVoxelSize: Option[Vec3Double])

object ExploreRemoteLayerParameters {
  implicit val jsonFormat: OFormat[ExploreRemoteLayerParameters] = Json.format[ExploreRemoteLayerParameters]
}

class ExploreRemoteLayerService {}
