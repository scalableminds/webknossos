package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Float
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.datareaders.precomputed.ShardingSpecification
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import play.api.libs.json.{Json, OFormat}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class NeuroglancerPrecomputedMeshInfo(
    lod_scale_multiplier: Double,
    transform: Array[Double],
    sharding: Option[ShardingSpecification],
    vertex_quantization_bits: Int,
)
object NeuroglancerPrecomputedMeshInfo {
  implicit val jsonFormat: OFormat[NeuroglancerPrecomputedMeshInfo] = Json.format[NeuroglancerPrecomputedMeshInfo]
}

class NeuroglancerPrecomputedMeshFileService @Inject()(remoteSourceDescriptorService: RemoteSourceDescriptorService)(
    implicit ec: ExecutionContext)
    extends FoxImplicits
    with NeuroglancerMeshHelper {

  private lazy val meshInfoCache = AlfuCache[MeshFileKey, NeuroglancerMesh](100)

  private def loadRemoteMeshInfo(meshFileKey: MeshFileKey)(implicit tc: TokenContext): Fox[NeuroglancerMesh] =
    for {
      vaultPath <- remoteSourceDescriptorService.vaultPathFor(meshFileKey.attachment)
      meshInfoPath = vaultPath / NeuroglancerMesh.FILENAME_INFO
      meshInfo <- meshInfoPath.parseAsJson[NeuroglancerPrecomputedMeshInfo] ?~> "Failed to read mesh info"
      _ <- Fox.fromBool(meshInfo.transform.length == 12) ?~> "Invalid mesh info: transform has to be of length 12"
    } yield NeuroglancerMesh(meshInfo)

  override def computeGlobalPosition(segmentInfo: NeuroglancerSegmentManifest,
                                     lod: Int,
                                     lodScaleMultiplier: Double,
                                     currentChunk: Int): Vec3Float =
    segmentInfo.chunkPositions(lod)(currentChunk).toVec3Float

  override def getLodTransform(segmentInfo: NeuroglancerSegmentManifest,
                               lodScaleMultiplier: Double,
                               transform: Array[Array[Double]],
                               lod: Int): Array[Array[Double]] = {
    val baseScale = Vec3Float(1, 1, 1) * lodScaleMultiplier * segmentInfo.chunkShape
    Array(
      Array(
        baseScale.x * transform(0)(0) * segmentInfo.lodScales(lod),
        transform(0)(1),
        transform(0)(2),
        transform(0)(3) + segmentInfo.gridOrigin.x + segmentInfo.vertexOffsets(lod).x
      ),
      Array(
        transform(1)(0),
        baseScale.y * transform(1)(1) * segmentInfo.lodScales(lod),
        transform(1)(2),
        transform(1)(3) + segmentInfo.gridOrigin.y + segmentInfo.vertexOffsets(lod).y
      ),
      Array(
        transform(2)(0),
        transform(2)(1),
        baseScale.z * transform(2)(2) * segmentInfo.lodScales(lod),
        transform(2)(3) + segmentInfo.gridOrigin.z + segmentInfo.vertexOffsets(lod).z
      ),
      Array(0.0, 0.0, 0.0, 1.0)
    )
  }

  def listMeshChunksForMultipleSegments(meshFileKey: MeshFileKey, segmentId: Seq[Long])(
      implicit tc: TokenContext): Fox[WebknossosSegmentInfo] =
    for {
      vaultPath <- remoteSourceDescriptorService.vaultPathFor(meshFileKey.attachment)
      mesh <- meshInfoCache.getOrLoad(meshFileKey, loadRemoteMeshInfo)
      chunkScale = Array.fill(3)(1 / math.pow(2, mesh.meshInfo.vertex_quantization_bits))
      meshSegmentInfos <- Fox.serialCombined(segmentId)(id => listMeshChunks(vaultPath, mesh, id))
      segmentInfo <- WebknossosSegmentInfo
        .fromMeshInfosAndMetadata(meshSegmentInfos, NeuroglancerMesh.meshEncoding, chunkScale = chunkScale)
        .toFox
    } yield segmentInfo

  private def listMeshChunks(vaultPath: VaultPath, mesh: NeuroglancerMesh, segmentId: Long)(
      implicit tc: TokenContext): Fox[List[MeshLodInfo]] =
    for {
      _ <- Fox.successful(())
      minishardInfo = mesh.shardingSpecification.getMinishardInfo(segmentId)
      shardUrl = mesh.shardingSpecification.getPathForShard(vaultPath, minishardInfo._1)
      minishardIndex <- mesh.getMinishardIndex(shardUrl, minishardInfo._2.toInt)
      chunkRange <- mesh.getChunkRange(segmentId, minishardIndex)
      chunk <- mesh.getChunk(chunkRange, shardUrl)
      segmentManifest = NeuroglancerSegmentManifest.fromBytes(chunk)
      meshSegmentInfo = enrichSegmentInfo(segmentManifest,
                                          mesh.meshInfo.lod_scale_multiplier,
                                          mesh.transformAsMatrix,
                                          chunkRange.start,
                                          segmentId)
    } yield meshSegmentInfo

  def readMeshChunk(meshFileKey: MeshFileKey, meshChunkDataRequests: Seq[MeshChunkDataRequest])(
      implicit tc: TokenContext): Fox[(Array[Byte], String)] =
    for {
      vaultPath <- remoteSourceDescriptorService.vaultPathFor(meshFileKey.attachment)
      segmentId <- meshChunkDataRequests.head.segmentId.toFox ?~> "Segment id parameter is required"
      _ <- Fox.fromBool(meshChunkDataRequests.flatMap(_.segmentId).distinct.length == 1) ?~> "All requests must have the same segment id"
      mesh <- meshInfoCache.getOrLoad(meshFileKey, loadRemoteMeshInfo)
      minishardInfo = mesh.shardingSpecification.getMinishardInfo(segmentId)
      shardUrl = mesh.shardingSpecification.getPathForShard(vaultPath, minishardInfo._1)
      chunks <- Fox.serialCombined(meshChunkDataRequests.toList)(request =>
        shardUrl.readBytes(Some(request.byteOffset until request.byteOffset + request.byteSize)))
      output = chunks.flatten.toArray
    } yield (output, NeuroglancerMesh.meshEncoding)

  def getVertexQuantizationBits(meshFileKey: MeshFileKey)(implicit tc: TokenContext): Fox[Int] =
    for {
      meshInfo <- meshInfoCache.getOrLoad(meshFileKey, loadRemoteMeshInfo)
    } yield meshInfo.meshInfo.vertex_quantization_bits

  def clearCache(dataSourceId: DataSourceId, layerNameOpt: Option[String]): Int =
    meshInfoCache.clear { meshFileKey =>
      meshFileKey.dataSourceId == dataSourceId && layerNameOpt.forall(meshFileKey.layerName == _)
    }
}
