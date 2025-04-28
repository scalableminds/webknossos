package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Float
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.datareaders.precomputed.{PrecomputedHeader, ShardingSpecification}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.{
  Category,
  DataFormat,
  DataLayer,
  DataLayerWithMagLocators,
  GenericDataSource
}
import com.scalableminds.webknossos.datastore.storage.{DataVaultService, RemoteSourceDescriptor}
import net.liftweb.common.Box.tryo
import play.api.libs.json.{Json, OFormat}

import java.net.URI
import java.nio.file.Paths
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

class NeuroglancerPrecomputedMeshFileService @Inject()(config: DataStoreConfig, dataVaultService: DataVaultService)(
    implicit ec: ExecutionContext)
    extends FoxImplicits
    with NeuroglancerMeshHelper {

  private val dataBaseDir = Paths.get(config.Datastore.baseDirectory)

  private lazy val neuroglancerPrecomputedMeshInfoCache = AlfuCache[VaultPath, NeuroglancerMesh](100)

  private def loadRemoteMeshInfo(meshPath: VaultPath)(implicit tc: TokenContext): Fox[NeuroglancerMesh] =
    for {
      _ <- Fox.successful(())
      meshInfoPath = meshPath / NeuroglancerMesh.FILENAME_INFO
      meshInfo <- meshInfoPath.parseAsJson[NeuroglancerPrecomputedMeshInfo] ?~> "Failed to read mesh info"
      _ <- Fox.fromBool(meshInfo.transform.length == 12) ?~> "Invalid mesh info: transform has to be of length 12"
    } yield NeuroglancerMesh(meshInfo)

  def exploreMeshFiles(organizationId: String, datasetName: String, dataLayerName: String)(
      implicit tc: TokenContext): Fox[Set[MeshFileInfo]] = {
    def exploreMeshesForLayer(dataLayer: DataLayer): Fox[(NeuroglancerPrecomputedMeshInfo, VaultPath)] =
      for {
        dataLayerWithMagLocators <- tryo(dataLayer.asInstanceOf[DataLayerWithMagLocators]).toFox ?~> "Invalid DataLayer: Expected DataLayer to have mag locators"
        firstMag <- dataLayerWithMagLocators.mags.headOption.toFox ?~> "No mags found"
        magPath <- firstMag.path.toFox ?~> "Mag has no path"
        remotePath <- dataVaultService.getVaultPath(RemoteSourceDescriptor(new URI(magPath), None))
        layerPath = remotePath.parent
        infoPath = layerPath / PrecomputedHeader.FILENAME_INFO
        precomputedHeader <- infoPath
          .parseAsJson[PrecomputedHeader] ?~> s"Failed to read neuroglancer precomputed metadata at $infoPath"
        meshPath = layerPath / precomputedHeader.meshPath
        mesh <- neuroglancerPrecomputedMeshInfoCache.getOrLoad(meshPath, loadRemoteMeshInfo)
      } yield (mesh.meshInfo, meshPath)

    def isDataLayerValid(d: DataLayer) =
      d.name == dataLayerName && d.category == Category.segmentation && d.dataFormat == DataFormat.neuroglancerPrecomputed

    val datasetDir = dataBaseDir.resolve(organizationId).resolve(datasetName)
    val datasetPropertiesFile = datasetDir.resolve(GenericDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON)
    for {
      datasetProperties <- JsonHelper
        .parseFromFileAs[GenericDataSource[DataLayer]](datasetPropertiesFile, datasetDir)
        .toFox
      meshInfosAndInfoPaths = datasetProperties.dataLayers.filter(isDataLayerValid).map(exploreMeshesForLayer)
      meshInfosResolved: List[(NeuroglancerPrecomputedMeshInfo, VaultPath)] <- Fox.fromFuture(
        Fox.sequenceOfFulls(meshInfosAndInfoPaths))
    } yield
      meshInfosResolved
        .map({
          case (_, vaultPath) =>
            MeshFileInfo(NeuroglancerMesh.meshName,
                         Some(vaultPath.toString),
                         Some(NeuroglancerMesh.meshTypeName),
                         None,
                         NeuroglancerMesh.meshInfoVersion)
        })
        .toSet
  }

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

  def listMeshChunksForMultipleSegments(meshFilePathOpt: Option[String], segmentId: List[Long])(
      implicit tc: TokenContext): Fox[WebknossosSegmentInfo] =
    for {
      meshFilePath <- meshFilePathOpt.toFox ?~> "No mesh file path provided"
      vaultPath <- dataVaultService.getVaultPath(RemoteSourceDescriptor(new URI(meshFilePath), None))
      mesh <- neuroglancerPrecomputedMeshInfoCache.getOrLoad(vaultPath, loadRemoteMeshInfo)
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

  def readMeshChunk(meshFilePathOpt: Option[String], meshChunkDataRequests: Seq[MeshChunkDataRequest])(
      implicit tc: TokenContext): Fox[(Array[Byte], String)] =
    for {
      meshFilePath <- meshFilePathOpt.toFox ?~> "Mesh file path is required"
      vaultPath <- dataVaultService.getVaultPath(RemoteSourceDescriptor(new URI(meshFilePath), None))
      mesh <- neuroglancerPrecomputedMeshInfoCache.getOrLoad(vaultPath, loadRemoteMeshInfo)
      segmentId <- meshChunkDataRequests.head.segmentId.toFox ?~> "Segment id parameter is required"
      _ = Fox.fromBool(meshChunkDataRequests.flatMap(_.segmentId).distinct.length == 1) ?~> "All requests must have the same segment id"
      minishardInfo = mesh.shardingSpecification.getMinishardInfo(segmentId)
      shardUrl = mesh.shardingSpecification.getPathForShard(vaultPath, minishardInfo._1)
      chunks <- Fox.serialCombined(meshChunkDataRequests.toList)(request =>
        shardUrl.readBytes(Some(request.byteOffset until request.byteOffset + request.byteSize)))
      output = chunks.flatten.toArray
    } yield (output, NeuroglancerMesh.meshEncoding)

  def getVertexQuantizationBits(meshFilePathOpt: Option[String])(implicit tc: TokenContext): Fox[Int] =
    for {
      meshFilePath <- meshFilePathOpt.toFox ?~> "Mesh file path is required"
      vaultPath <- dataVaultService.getVaultPath(RemoteSourceDescriptor(new URI(meshFilePath), None))
      mesh <- neuroglancerPrecomputedMeshInfoCache.getOrLoad(vaultPath, loadRemoteMeshInfo)
    } yield mesh.meshInfo.vertex_quantization_bits

}
