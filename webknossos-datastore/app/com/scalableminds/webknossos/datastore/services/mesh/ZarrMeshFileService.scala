package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3GroupHeader
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.services.ChunkCacheService
import play.api.libs.json.{Json, OFormat}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class MeshfileAttributes(
    mesh_format: String,
    lod_scale_multiplier: Double,
    transform: Array[Array[Double]]
)

object MeshfileAttributes {
  implicit val jsonFormat: OFormat[MeshfileAttributes] = Json.format[MeshfileAttributes]
}

class ZarrMeshFileService @Inject()(chunkCacheService: ChunkCacheService) extends FoxImplicits {

  def readMeshfileMetadata(meshFilePath: VaultPath)(implicit ec: ExecutionContext,
                                                    tc: TokenContext): Fox[(String, Double, Array[Array[Double]])] =
    for {
      groupHeaderBytes <- (meshFilePath / Zarr3GroupHeader.FILENAME_ZARR_JSON).readBytes()
      groupHeader <- JsonHelper.parseAs[Zarr3GroupHeader](groupHeaderBytes).toFox ?~> "Could not parse array header"
      meshfileAttributes <- groupHeader.meshfileAttributes.toFox ?~> "Could not parse meshfile attributes from zarr group file"
    } yield (meshfileAttributes.mesh_format, meshfileAttributes.lod_scale_multiplier, meshfileAttributes.transform)

}
