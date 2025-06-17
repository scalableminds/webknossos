package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Float
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.datareaders.DatasetArray
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3Array
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.services.{ChunkCacheService, Hdf5HashedArrayUtils}
import com.scalableminds.webknossos.datastore.storage.{DataVaultService, RemoteSourceDescriptor}
import net.liftweb.common.Box.tryo
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{JsResult, JsValue, Reads}
import ucar.ma2.{Array => MultiArray}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class MeshfileAttributes(
    formatVersion: Long,
    meshFormat: String, // AKA encoding (e.g. "draco")
    lodScaleMultiplier: Double,
    transform: Array[Array[Double]],
    hashFunction: String,
    nBuckets: Int,
    mappingName: Option[String]
) extends Hdf5HashedArrayUtils {
  lazy val applyHashFunction: Long => Long = getHashFunction(hashFunction)
}

object MeshfileAttributes {
  val FILENAME_ZARR_JSON = "zarr.json"

  implicit object MeshfileAttributesZarr3GroupHeaderReads extends Reads[MeshfileAttributes] {
    override def reads(json: JsValue): JsResult[MeshfileAttributes] = {
      val keyAttributes = "attributes"
      val keyVx = "voxelytics"
      val keyFormatVersion = "artifact_schema_version"
      val keyArtifactAttrs = "artifact_attributes"
      val meshfileAttrs = json \ keyAttributes \ keyVx \ keyArtifactAttrs
      for {
        formatVersion <- (json \ keyAttributes \ keyVx \ keyFormatVersion).validate[Long]
        meshFormat <- (meshfileAttrs \ "mesh_format").validate[String]
        lodScaleMultiplier <- (meshfileAttrs \ "lod_scale_multiplier").validate[Double]
        transform <- (meshfileAttrs \ "transform").validate[Array[Array[Double]]]
        hashFunction <- (meshfileAttrs \ "hash_function").validate[String]
        nBuckets <- (meshfileAttrs \ "n_buckets").validate[Int]
        mappingName <- (meshfileAttrs \ "mapping_name").validateOpt[String]
      } yield
        MeshfileAttributes(
          formatVersion,
          meshFormat,
          lodScaleMultiplier,
          transform,
          hashFunction,
          nBuckets,
          mappingName,
        )
    }
  }
}

class ZarrMeshFileService @Inject()(chunkCacheService: ChunkCacheService, dataVaultService: DataVaultService)
    extends FoxImplicits
    with NeuroglancerMeshHelper {

  private val keyBucketOffsets = "bucket_offsets"
  private val keyBuckets = "buckets"
  private val keyNeuroglancer = "neuroglancer"

    private lazy val openArraysCache = AlfuCache[(MeshfileKey, String), DatasetArray]()
  private lazy val attributesCache = AlfuCache[MeshfileKey, MeshfileAttributes]()

  private def readMeshFileAttributesImpl(meshFileKey: MeshfileKey)(implicit ec: ExecutionContext,
                                                                   tc: TokenContext): Fox[MeshfileAttributes] =
    for {
      groupVaultPath <- dataVaultService.getVaultPath(RemoteSourceDescriptor(meshFileKey.attachment.path, None))
      groupHeaderBytes <- (groupVaultPath / MeshfileAttributes.FILENAME_ZARR_JSON).readBytes()
      meshfileAttributes <- JsonHelper
        .parseAs[MeshfileAttributes](groupHeaderBytes)
        .toFox ?~> "Could not parse meshfile attributes from zarr group file"
    } yield meshfileAttributes

  private def readMeshfileAttributes(meshfileKey: MeshfileKey)(implicit ec: ExecutionContext,
                                                               tc: TokenContext): Fox[MeshfileAttributes] =
    attributesCache.getOrLoad(meshfileKey, key => readMeshFileAttributesImpl(key))

  def readMeshfileMetadata(meshFileKey: MeshfileKey)(implicit ec: ExecutionContext,
                                                     tc: TokenContext): Fox[(String, Double, Array[Array[Double]])] =
    for {
      meshfileAttributes <- readMeshfileAttributes(meshFileKey)
    } yield (meshfileAttributes.meshFormat, meshfileAttributes.lodScaleMultiplier, meshfileAttributes.transform)

  def versionForMeshFile(meshFileKey: MeshfileKey)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Long] =
    for {
      meshfileAttributes <- readMeshfileAttributes(meshFileKey)
    } yield meshfileAttributes.formatVersion

  def mappingNameForMeshFile(meshFileKey: MeshfileKey)(implicit ec: ExecutionContext,
                                                       tc: TokenContext): Fox[Option[String]] =
    for {
      meshfileAttributes <- readMeshfileAttributes(meshFileKey)
    } yield meshfileAttributes.mappingName

  def listMeshChunksForSegment(meshFileKey: MeshfileKey, segmentId: Long, meshfileAttributes: MeshfileAttributes)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[MeshLodInfo]] =
    for {
      (neuroglancerSegmentManifestStart, neuroglancerSegmentManifestEnd) <- getNeuroglancerSegmentManifestOffsets(
        meshFileKey,
        meshfileAttributes,
        segmentId)
      neuroglancerArray <- openZarrArray(meshFileKey, keyNeuroglancer)
      manifestBytes <- neuroglancerArray.readAsMultiArray(
        offset = neuroglancerSegmentManifestStart,
        shape = (neuroglancerSegmentManifestEnd - neuroglancerSegmentManifestStart).toInt)
      segmentManifest <- tryo(NeuroglancerSegmentManifest.fromBytes(manifestBytes.getStorage.asInstanceOf[Array[Byte]])).toFox
    } yield
      enrichSegmentInfo(segmentManifest,
                        meshfileAttributes.lodScaleMultiplier,
                        meshfileAttributes.transform,
                        neuroglancerSegmentManifestStart,
                        segmentId)

  private def getNeuroglancerSegmentManifestOffsets(
      meshFileKey: MeshfileKey,
      meshfileAttributes: MeshfileAttributes,
      segmentId: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[(Long, Long)] = {
    val bucketIndex = meshfileAttributes.applyHashFunction(segmentId) % meshfileAttributes.nBuckets
    for {
      bucketOffsetsArray <- openZarrArray(meshFileKey, keyBucketOffsets)
      bucketRange <- bucketOffsetsArray.readAsMultiArray(offset = bucketIndex, shape = 2)
      bucketStart <- tryo(bucketRange.getLong(0)).toFox
      bucketEnd <- tryo(bucketRange.getLong(1)).toFox
      bucketSize = (bucketEnd - bucketStart).toInt
      _ <- Fox.fromBool(bucketSize > 0) ?~> s"No entry for segment $segmentId"
      bucketsArray <- openZarrArray(meshFileKey, keyBuckets)
      bucket <- bucketsArray.readAsMultiArray(offset = Array(bucketStart, 0), shape = Array(bucketSize + 1, 3))
      bucketLocalOffset <- findLocalOffsetInBucket(bucket, segmentId).toFox ?~> s"SegmentId $segmentId not in bucket list"
      neuroglancerStart = bucket.getLong(bucket.getIndex.set(Array(bucketLocalOffset, 1)))
      neuroglancerEnd = bucket.getLong(bucket.getIndex.set(Array(bucketLocalOffset, 2)))
    } yield (neuroglancerStart, neuroglancerEnd)
  }

  private def findLocalOffsetInBucket(bucket: MultiArray, segmentId: Long): Option[Int] =
    (0 until bucket.getShape()(0)).find(idx => bucket.getLong(bucket.getIndex.set(Array(idx, 0))) == segmentId)

  private def openZarrArray(meshFileKey: MeshfileKey, zarrArrayName: String)(implicit ec: ExecutionContext,
                                                                             tc: TokenContext): Fox[DatasetArray] =
    openArraysCache.getOrLoad((meshFileKey, zarrArrayName), _ => openZarrArrayImpl(meshFileKey, zarrArrayName))

  private def openZarrArrayImpl(meshFileKey: MeshfileKey, zarrArrayName: String)(implicit ec: ExecutionContext,
                                                                                 tc: TokenContext): Fox[DatasetArray] =
    for {
      groupVaultPath <- dataVaultService.getVaultPath(RemoteSourceDescriptor(meshFileKey.attachment.path, None))
      zarrArray <- Zarr3Array.open(groupVaultPath / zarrArrayName,
                                   DataSourceId("dummy", "unused"),
                                   "layer",
                                   None,
                                   None,
                                   None,
                                   chunkCacheService.sharedChunkContentsCache)
    } yield zarrArray

  override def computeGlobalPosition(segmentInfo: NeuroglancerSegmentManifest,
                                     lod: Int,
                                     lodScaleMultiplier: Double,
                                     currentChunk: Int): Vec3Float =
    segmentInfo.gridOrigin + segmentInfo.chunkPositions(lod)(currentChunk).toVec3Float * segmentInfo.chunkShape * Math
      .pow(2, lod) * segmentInfo.lodScales(lod) * lodScaleMultiplier

  override def getLodTransform(segmentInfo: NeuroglancerSegmentManifest,
                               lodScaleMultiplier: Double,
                               transform: Array[Array[Double]],
                               lod: Int): Array[Array[Double]] = transform

  def listMeshChunksForMultipleSegments(meshFileKey: MeshfileKey, segmentIds: Seq[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext,
      m: MessagesProvider): Fox[WebknossosSegmentInfo] =
    for {
      meshfileAttributes <- readMeshfileAttributes(meshFileKey)
      meshChunksForUnmappedSegments: List[List[MeshLodInfo]] <- listMeshChunksForSegmentsNested(meshFileKey,
                                                                                                segmentIds,
                                                                                                meshfileAttributes)
      _ <- Fox.fromBool(meshChunksForUnmappedSegments.nonEmpty) ?~> "zero chunks" ?~> Messages(
        "mesh.file.listChunks.failed",
        segmentIds.mkString(","),
        meshFileKey.attachment.name)
      wkChunkInfos <- WebknossosSegmentInfo
        .fromMeshInfosAndMetadata(meshChunksForUnmappedSegments, meshfileAttributes.meshFormat)
        .toFox
    } yield wkChunkInfos

  private def listMeshChunksForSegmentsNested(meshFileKey: MeshfileKey,
                                              segmentIds: Seq[Long],
                                              meshfileAttributes: MeshfileAttributes)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[List[MeshLodInfo]]] =
    Fox.serialCombined(segmentIds) { segmentId =>
      listMeshChunksForSegment(meshFileKey, segmentId, meshfileAttributes)
    }

  def readMeshChunk(meshFileKey: MeshfileKey, meshChunkDataRequests: Seq[MeshChunkDataRequest])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[(Array[Byte], String)] =
    for {
      meshfileAttributes <- readMeshfileAttributes(meshFileKey)

      // TODO skip sorting in zarr case? use parallel requests instead?
      // Sort the requests by byte offset to optimize for spinning disk access
      requestsReordered = meshChunkDataRequests.zipWithIndex
        .sortBy(requestAndIndex => requestAndIndex._1.byteOffset)
        .toList
      neuroglancerArray <- openZarrArray(meshFileKey, keyNeuroglancer)
      data: List[(Array[Byte], Int)] <- Fox.serialCombined(requestsReordered) { requestAndIndex =>
        val meshChunkDataRequest = requestAndIndex._1
        for {
          dataAsMultiArray <- neuroglancerArray.readAsMultiArray(offset = meshChunkDataRequest.byteOffset,
                                                                 meshChunkDataRequest.byteSize)
        } yield (dataAsMultiArray.getStorage.asInstanceOf[Array[Byte]], requestAndIndex._2)
      }
      dataSorted = data.sortBy(d => d._2)
      dataSortedFlat = dataSorted.flatMap(d => d._1).toArray
    } yield (dataSortedFlat, meshfileAttributes.meshFormat)

  def clearCache(dataSourceId: DataSourceId, layerNameOpt: Option[String]): Int = {
    attributesCache.clear { meshFileKey =>
      meshFileKey.dataSourceId == dataSourceId && layerNameOpt.forall(meshFileKey.layerName == _)
    }

    openArraysCache.clear {
      case (meshFileKey, _) =>
        meshFileKey.dataSourceId == dataSourceId && layerNameOpt.forall(meshFileKey.layerName == _)
    }
  }
}
