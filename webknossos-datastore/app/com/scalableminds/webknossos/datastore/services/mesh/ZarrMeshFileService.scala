package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Float
import com.scalableminds.util.box.Box.tryo
import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.datareaders.DatasetArray
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3Array
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.services.{
  ArrayArtifactHashing,
  DSChunkCacheService,
  VoxelyticsZarrArtifactUtils
}
import com.scalableminds.webknossos.datastore.storage.DataVaultService
import play.api.libs.json.{JsResult, JsValue, Reads}
import ucar.ma2.Array as MultiArray

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class MeshFileAttributes(
    formatVersion: Long,
    meshFormat: String, // AKA encoding (e.g. "draco")
    lodScaleMultiplier: Double,
    transform: Array[Array[Double]],
    hashFunction: String,
    nBuckets: Long,
    mappingName: Option[String]
) extends ArrayArtifactHashing {
  lazy val applyHashFunction: Long => Long = getHashFunction(hashFunction)
}

object MeshFileAttributes extends MeshFileUtils with VoxelyticsZarrArtifactUtils {
  implicit object MeshFileAttributesZarr3GroupHeaderReads extends Reads[MeshFileAttributes] {
    override def reads(json: JsValue): JsResult[MeshFileAttributes] = {
      val meshFileAttrs = lookUpArtifactAttributes(json)
      for {
        formatVersion <- readArtifactSchemaVersion(json)
        meshFormat <- (meshFileAttrs \ attrKeyMeshFormat).validate[String]
        lodScaleMultiplier <- (meshFileAttrs \ attrKeyLodScaleMultiplier).validate[Double]
        transform <- (meshFileAttrs \ attrKeyTransform).validate[Array[Array[Double]]]
        hashFunction <- (meshFileAttrs \ attrKeyHashFunction).validate[String]
        nBuckets <- (meshFileAttrs \ attrKeyNBuckets).validate[Long]
        mappingName <- (meshFileAttrs \ attrKeyMappingName).validateOpt[String]
      } yield MeshFileAttributes(
        formatVersion,
        meshFormat,
        lodScaleMultiplier,
        transform,
        hashFunction,
        nBuckets,
        mappingName
      )
    }
  }
}

class ZarrMeshFileService @Inject() (chunkCacheService: DSChunkCacheService, dataVaultService: DataVaultService)
    extends MeshFileUtils
    with NeuroglancerMeshHelper {

  private lazy val openArraysCache = AlfuCache[(MeshFileKey, String), DatasetArray]()
  private lazy val attributesCache = AlfuCache[MeshFileKey, MeshFileAttributes]()

  private def readMeshFileAttributesImpl(
      meshFileKey: MeshFileKey
  )(using ec: ExecutionContext, tc: TokenContext): Fox[MeshFileAttributes] =
    for {
      groupVaultPath <- dataVaultService.vaultPathFor(meshFileKey.attachment)
      groupHeaderBytes <- (groupVaultPath / MeshFileAttributes.FILENAME_ZARR_JSON)
        .readBytes() ?~> "Could not read mesh file zarr group file"
      meshFileAttributes <- JsonHelper
        .parseAs[MeshFileAttributes](groupHeaderBytes)
        .toFox ?~> "Could not parse meshFile attributes from zarr group file."
    } yield meshFileAttributes

  private def readMeshFileAttributes(
      meshFileKey: MeshFileKey
  )(using ec: ExecutionContext, tc: TokenContext): Fox[MeshFileAttributes] =
    attributesCache.getOrLoad(meshFileKey, key => readMeshFileAttributesImpl(key))

  def readMeshFileMetadata(
      meshFileKey: MeshFileKey
  )(using ec: ExecutionContext, tc: TokenContext): Fox[(String, Double, Array[Array[Double]])] =
    for {
      meshFileAttributes <- readMeshFileAttributes(meshFileKey)
    } yield (meshFileAttributes.meshFormat, meshFileAttributes.lodScaleMultiplier, meshFileAttributes.transform)

  def versionForMeshFile(meshFileKey: MeshFileKey)(using ec: ExecutionContext, tc: TokenContext): Fox[Long] =
    for {
      meshFileAttributes <- readMeshFileAttributes(meshFileKey)
    } yield meshFileAttributes.formatVersion

  def mappingNameForMeshFile(
      meshFileKey: MeshFileKey
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Option[String]] =
    for {
      meshFileAttributes <- readMeshFileAttributes(meshFileKey)
    } yield meshFileAttributes.mappingName

  def listMeshChunksForSegment(meshFileKey: MeshFileKey, segmentId: Long, meshFileAttributes: MeshFileAttributes)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[List[MeshLodInfo]] =
    for {
      (neuroglancerSegmentManifestStart, neuroglancerSegmentManifestEnd) <- getNeuroglancerSegmentManifestOffsets(
        meshFileKey,
        meshFileAttributes,
        segmentId
      )
      neuroglancerArray <- openZarrArray(meshFileKey, keyNeuroglancer)
      manifestBytes <- neuroglancerArray.readAsMultiArray(
        offset = neuroglancerSegmentManifestStart,
        shape = (neuroglancerSegmentManifestEnd - neuroglancerSegmentManifestStart).toInt
      )
      segmentManifest <- tryo(
        NeuroglancerSegmentManifest.fromBytes(manifestBytes.getStorage.asInstanceOf[Array[Byte]])
      ).toFox
    } yield enrichSegmentInfo(
      segmentManifest,
      meshFileAttributes.lodScaleMultiplier,
      meshFileAttributes.transform,
      neuroglancerSegmentManifestStart,
      segmentId
    )

  private def getNeuroglancerSegmentManifestOffsets(
      meshFileKey: MeshFileKey,
      meshFileAttributes: MeshFileAttributes,
      segmentId: Long
  )(using ec: ExecutionContext, tc: TokenContext): Fox[(Long, Long)] = {
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
      bucketLocalOffset <- findLocalOffsetInBucket(
        bucket,
        segmentId
      ).toFox ?~> s"SegmentId $segmentId not in bucket list"
      neuroglancerStart = bucket.getLong(bucket.getIndex.set(Array(bucketLocalOffset, 1)))
      neuroglancerEnd = bucket.getLong(bucket.getIndex.set(Array(bucketLocalOffset, 2)))
    } yield (neuroglancerStart, neuroglancerEnd)
  }

  private def findLocalOffsetInBucket(bucket: MultiArray, segmentId: Long): Option[Int] =
    (0 until bucket.getShape()(0)).find(idx => bucket.getLong(bucket.getIndex.set(Array(idx, 0))) == segmentId)

  private def openZarrArray(meshFileKey: MeshFileKey, zarrArrayName: String)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[DatasetArray] =
    openArraysCache.getOrLoad((meshFileKey, zarrArrayName), _ => openZarrArrayImpl(meshFileKey, zarrArrayName))

  private def openZarrArrayImpl(meshFileKey: MeshFileKey, zarrArrayName: String)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[DatasetArray] =
    for {
      groupVaultPath <- dataVaultService.vaultPathFor(meshFileKey.attachment)
      zarrArray <- Zarr3Array.open(
        groupVaultPath / zarrArrayName,
        DataSourceId("dummy", "unused"),
        "layer",
        None,
        None,
        None,
        chunkCacheService.sharedChunkContentsCache
      )
    } yield zarrArray

  override def computeGlobalPosition(
      segmentInfo: NeuroglancerSegmentManifest,
      lod: Int,
      lodScaleMultiplier: Double,
      currentChunk: Int
  ): Vec3Float =
    segmentInfo.gridOrigin + segmentInfo.chunkPositions(lod)(currentChunk).toVec3Float * segmentInfo.chunkShape * Math
      .pow(2, lod) * segmentInfo.lodScales(lod) * lodScaleMultiplier

  override def getLodTransform(
      segmentInfo: NeuroglancerSegmentManifest,
      lodScaleMultiplier: Double,
      transform: Array[Array[Double]],
      lod: Int
  ): Array[Array[Double]] = transform

  def listMeshChunksForMultipleSegments(meshFileKey: MeshFileKey, segmentIds: Seq[Long])(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[WebknossosSegmentInfo] =
    for {
      meshFileAttributes <- readMeshFileAttributes(meshFileKey)
      meshChunksForUnmappedSegments: List[List[MeshLodInfo]] <- listMeshChunksForSegmentsNested(
        meshFileKey,
        segmentIds,
        meshFileAttributes
      ) ?~> Msg.Mesh.File.listChunksFailed(segmentIds.mkString(","), meshFileKey.attachment.name)
      _ <- Fox.fromBool(meshChunksForUnmappedSegments.nonEmpty) ?~> Msg.Mesh.File
        .zeroChunks(segmentIds.mkString(","), meshFileKey.attachment.name)
      wkChunkInfos <- WebknossosSegmentInfo
        .fromMeshInfosAndMetadata(meshChunksForUnmappedSegments, meshFileAttributes.meshFormat)
        .toFox
    } yield wkChunkInfos

  private def listMeshChunksForSegmentsNested(
      meshFileKey: MeshFileKey,
      segmentIds: Seq[Long],
      meshFileAttributes: MeshFileAttributes
  )(using ec: ExecutionContext, tc: TokenContext): Fox[List[List[MeshLodInfo]]] = {
    def lookupOne(segmentId: Long): Fox[Option[List[MeshLodInfo]]] =
      listMeshChunksForSegment(meshFileKey, segmentId, meshFileAttributes).map(Some(_)).orElse(Fox.successful(None))
    if (meshFileKey.attachment.path.isRemote)
      Fox.batchCombined(segmentIds, parallelity = 32)(lookupOne).map(_.flatten)
    else
      Fox.serialCombined(segmentIds)(lookupOne).map(_.flatten)
  }

  def readMeshChunk(meshFileKey: MeshFileKey, meshChunkDataRequests: Seq[MeshChunkDataRequest])(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[(Array[Byte], String)] =
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
          dataAsMultiArray <- neuroglancerArray.readAsMultiArray(
            offset = meshChunkDataRequest.byteOffset,
            meshChunkDataRequest.byteSize
          )
        } yield (dataAsMultiArray.getStorage.asInstanceOf[Array[Byte]], requestAndIndex._2)
      }
      dataSorted = data.sortBy(d => d._2)
      dataSortedFlat = dataSorted.flatMap(d => d._1).toArray
    } yield (dataSortedFlat, meshFileAttributes.meshFormat)

  def clearCache(dataSourceId: DataSourceId, layerNameOpt: Option[String]): Int = {
    attributesCache.clear { meshFileKey =>
      meshFileKey.dataSourceId == dataSourceId && layerNameOpt.forall(meshFileKey.layerName == _)
    }

    openArraysCache.clear { case (meshFileKey, _) =>
      meshFileKey.dataSourceId == dataSourceId && layerNameOpt.forall(meshFileKey.layerName == _)
    }
  }
}
