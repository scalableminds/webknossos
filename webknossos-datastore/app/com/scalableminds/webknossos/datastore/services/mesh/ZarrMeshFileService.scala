package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Float
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.datareaders.DatasetArray
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3Array
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.services.{ChunkCacheService, Hdf5HashedArrayUtils}
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import net.liftweb.common.Box.tryo
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{JsResult, JsValue, Reads}
import ucar.ma2.{Array => MultiArray}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class MeshFileAttributes(
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

object MeshFileAttributes {
  val FILENAME_ZARR_JSON = "zarr.json"

  implicit object MeshFileAttributesZarr3GroupHeaderReads extends Reads[MeshFileAttributes] {
    override def reads(json: JsValue): JsResult[MeshFileAttributes] = {
      val keyAttributes = "attributes"
      val keyVx = "voxelytics"
      val keyFormatVersion = "artifact_schema_version"
      val keyArtifactAttrs = "artifact_attributes"
      val meshFileAttrs = json \ keyAttributes \ keyVx \ keyArtifactAttrs
      for {
        formatVersion <- (json \ keyAttributes \ keyVx \ keyFormatVersion).validate[Long]
        meshFormat <- (meshFileAttrs \ "mesh_format").validate[String]
        lodScaleMultiplier <- (meshFileAttrs \ "lod_scale_multiplier").validate[Double]
        transform <- (meshFileAttrs \ "transform").validate[Array[Array[Double]]]
        hashFunction <- (meshFileAttrs \ "hash_function").validate[String]
        nBuckets <- (meshFileAttrs \ "n_buckets").validate[Int]
        mappingName <- (meshFileAttrs \ "mapping_name").validateOpt[String]
      } yield
        MeshFileAttributes(
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

class ZarrMeshFileService @Inject()(chunkCacheService: ChunkCacheService,
                                    remoteSourceDescriptorService: RemoteSourceDescriptorService)
    extends FoxImplicits
    with NeuroglancerMeshHelper {

  private val keyBucketOffsets = "bucket_offsets"
  private val keyBuckets = "buckets"
  private val keyNeuroglancer = "neuroglancer"

  private lazy val openArraysCache = AlfuCache[(MeshFileKey, String), DatasetArray]()
  private lazy val attributesCache = AlfuCache[MeshFileKey, MeshFileAttributes]()

  private def readMeshFileAttributesImpl(meshFileKey: MeshFileKey)(implicit ec: ExecutionContext,
                                                                   tc: TokenContext): Fox[MeshFileAttributes] =
    for {
      groupVaultPath <- remoteSourceDescriptorService.vaultPathFor(meshFileKey.attachment)
      groupHeaderBytes <- (groupVaultPath / MeshFileAttributes.FILENAME_ZARR_JSON).readBytes()
      meshFileAttributes <- JsonHelper
        .parseAs[MeshFileAttributes](groupHeaderBytes)
        .toFox ?~> "Could not parse meshFile attributes from zarr group file"
    } yield meshFileAttributes

  private def readMeshFileAttributes(meshFileKey: MeshFileKey)(implicit ec: ExecutionContext,
                                                               tc: TokenContext): Fox[MeshFileAttributes] =
    attributesCache.getOrLoad(meshFileKey, key => readMeshFileAttributesImpl(key))

  def readMeshFileMetadata(meshFileKey: MeshFileKey)(implicit ec: ExecutionContext,
                                                     tc: TokenContext): Fox[(String, Double, Array[Array[Double]])] =
    for {
      meshFileAttributes <- readMeshFileAttributes(meshFileKey)
    } yield (meshFileAttributes.meshFormat, meshFileAttributes.lodScaleMultiplier, meshFileAttributes.transform)

  def versionForMeshFile(meshFileKey: MeshFileKey)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Long] =
    for {
      meshFileAttributes <- readMeshFileAttributes(meshFileKey)
    } yield meshFileAttributes.formatVersion

  def mappingNameForMeshFile(meshFileKey: MeshFileKey)(implicit ec: ExecutionContext,
                                                       tc: TokenContext): Fox[Option[String]] =
    for {
      meshFileAttributes <- readMeshFileAttributes(meshFileKey)
    } yield meshFileAttributes.mappingName

  def listMeshChunksForSegment(meshFileKey: MeshFileKey, segmentId: Long, meshFileAttributes: MeshFileAttributes)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[MeshLodInfo]] =
    for {
      (neuroglancerSegmentManifestStart, neuroglancerSegmentManifestEnd) <- getNeuroglancerSegmentManifestOffsets(
        meshFileKey,
        meshFileAttributes,
        segmentId)
      neuroglancerArray <- openZarrArray(meshFileKey, keyNeuroglancer)
      manifestBytes <- neuroglancerArray.readAsMultiArray(
        offset = neuroglancerSegmentManifestStart,
        shape = (neuroglancerSegmentManifestEnd - neuroglancerSegmentManifestStart).toInt)
      segmentManifest <- tryo(NeuroglancerSegmentManifest.fromBytes(manifestBytes.getStorage.asInstanceOf[Array[Byte]])).toFox
    } yield
      enrichSegmentInfo(segmentManifest,
                        meshFileAttributes.lodScaleMultiplier,
                        meshFileAttributes.transform,
                        neuroglancerSegmentManifestStart,
                        segmentId)

  private def getNeuroglancerSegmentManifestOffsets(
      meshFileKey: MeshFileKey,
      meshFileAttributes: MeshFileAttributes,
      segmentId: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[(Long, Long)] = {
    val bucketIndex = meshFileAttributes.applyHashFunction(segmentId) % meshFileAttributes.nBuckets
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

  private def openZarrArray(meshFileKey: MeshFileKey, zarrArrayName: String)(implicit ec: ExecutionContext,
                                                                             tc: TokenContext): Fox[DatasetArray] =
    openArraysCache.getOrLoad((meshFileKey, zarrArrayName), _ => openZarrArrayImpl(meshFileKey, zarrArrayName))

  private def openZarrArrayImpl(meshFileKey: MeshFileKey, zarrArrayName: String)(implicit ec: ExecutionContext,
                                                                                 tc: TokenContext): Fox[DatasetArray] =
    for {
      groupVaultPath <- remoteSourceDescriptorService.vaultPathFor(meshFileKey.attachment)
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

  def listMeshChunksForMultipleSegments(meshFileKey: MeshFileKey, segmentIds: Seq[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext,
      m: MessagesProvider): Fox[WebknossosSegmentInfo] =
    for {
      meshFileAttributes <- readMeshFileAttributes(meshFileKey)
      meshChunksForUnmappedSegments: List[List[MeshLodInfo]] <- listMeshChunksForSegmentsNested(meshFileKey,
                                                                                                segmentIds,
                                                                                                meshFileAttributes)
      _ <- Fox.fromBool(meshChunksForUnmappedSegments.nonEmpty) ?~> "zero chunks" ?~> Messages(
        "mesh.file.listChunks.failed",
        segmentIds.mkString(","),
        meshFileKey.attachment.name)
      wkChunkInfos <- WebknossosSegmentInfo
        .fromMeshInfosAndMetadata(meshChunksForUnmappedSegments, meshFileAttributes.meshFormat)
        .toFox
    } yield wkChunkInfos

  private def listMeshChunksForSegmentsNested(meshFileKey: MeshFileKey,
                                              segmentIds: Seq[Long],
                                              meshFileAttributes: MeshFileAttributes)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[List[MeshLodInfo]]] =
    Fox.serialCombined(segmentIds) { segmentId =>
      listMeshChunksForSegment(meshFileKey, segmentId, meshFileAttributes)
    }

  def readMeshChunk(meshFileKey: MeshFileKey, meshChunkDataRequests: Seq[MeshChunkDataRequest])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[(Array[Byte], String)] =
    for {
      meshFileAttributes <- readMeshFileAttributes(meshFileKey)

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
    } yield (dataSortedFlat, meshFileAttributes.meshFormat)

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
