package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.FoxImplicits
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import play.api.libs.json.{Json, OFormat}

trait GenericJsonFormat[T] {
  implicit val jsonFormat: OFormat[T] = Json.format[T]
}

case class ListMeshChunksRequest(
    segmentId: Long,
    mag: Int
)

object ListMeshChunksRequest extends GenericJsonFormat[ListMeshChunksRequest]
object MeshChunkDataRequest extends GenericJsonFormat[MeshChunkDataRequest]

case class MeshChunkDataRequest(
    position: Point3D,
    segmentId: Long,
    mag: Int
)

class MeshFileService @Inject()(config: DataStoreConfig) extends FoxImplicits with LazyLogging {}
