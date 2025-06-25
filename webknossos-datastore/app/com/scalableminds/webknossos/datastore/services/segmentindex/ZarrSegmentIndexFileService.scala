package com.scalableminds.webknossos.datastore.services.segmentindex

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.datareaders.DatasetArray
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3Array
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.services.{ArrayArtifactHashing, ChunkCacheService}
import ucar.ma2.{Array => MultiArray}
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import play.api.libs.json.{JsResult, JsValue, Reads}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class SegmentIndexFileAttributes(
    formatVersion: Long,
    mag: Vec3Int,
    nHashBuckets: Long,
    hashFunction: String,
    dtypeBucketEntries: String,
) extends ArrayArtifactHashing {
  lazy val applyHashFunction: Long => Long = getHashFunction(hashFunction)
}

object SegmentIndexFileAttributes {
  val FILENAME_ZARR_JSON = "zarr.json"

  implicit object SegmentIndexFileAttributesZarr3GroupHeaderReads extends Reads[SegmentIndexFileAttributes] {
    override def reads(json: JsValue): JsResult[SegmentIndexFileAttributes] = {
      val keyAttributes = "attributes"
      val keyVx = "voxelytics"
      val keyFormatVersion = "artifact_schema_version"
      val keyArtifactAttrs = "artifact_attributes"
      val segmentIndexFileAttrs = json \ keyAttributes \ keyVx \ keyArtifactAttrs
      for {
        formatVersion <- (json \ keyAttributes \ keyVx \ keyFormatVersion).validate[Long]
        mag <- (segmentIndexFileAttrs \ "mag").validate[Vec3Int]
        nHashBuckets <- (segmentIndexFileAttrs \ "n_hash_buckets").validate[Long]
        hashFunction <- (segmentIndexFileAttrs \ "hash_function").validate[String]
        dtypeBucketEntries <- (segmentIndexFileAttrs \ "dtype_bucket_entries").validate[String]
      } yield
        SegmentIndexFileAttributes(
          formatVersion,
          mag,
          nHashBuckets,
          hashFunction,
          dtypeBucketEntries
        )
    }
  }
}

class ZarrSegmentIndexFileService @Inject()(remoteSourceDescriptorService: RemoteSourceDescriptorService,
                                            chunkCacheService: ChunkCacheService)
    extends FoxImplicits {

  // TODO clear caches

  private val keyHashBucketOffsets = "hash_bucket_offsets"
  private val keyHashBuckets = "hash_buckets"
  private val keyTopLefts = "top_lefts"

  private lazy val openArraysCache = AlfuCache[(SegmentIndexFileKey, String), DatasetArray]()
  private lazy val attributesCache = AlfuCache[SegmentIndexFileKey, SegmentIndexFileAttributes]()

  private def readSegmentIndexFileAttributes(segmentIndexFileKey: SegmentIndexFileKey)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[SegmentIndexFileAttributes] =
    attributesCache.getOrLoad(segmentIndexFileKey, key => readSegmentIndexFileAttributesImpl(key))

  private def readSegmentIndexFileAttributesImpl(segmentIndexFileKey: SegmentIndexFileKey)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[SegmentIndexFileAttributes] =
    for {
      groupVaultPath <- remoteSourceDescriptorService.vaultPathFor(segmentIndexFileKey.attachment)
      groupHeaderBytes <- (groupVaultPath / SegmentIndexFileAttributes.FILENAME_ZARR_JSON).readBytes()
      segmentIndexFileAttributes <- JsonHelper
        .parseAs[SegmentIndexFileAttributes](groupHeaderBytes)
        .toFox ?~> "Could not parse meshFile attributes from zarr group file"
    } yield segmentIndexFileAttributes

  def readSegmentIndex(segmentIndexFileKey: SegmentIndexFileKey,
                       segmentId: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Array[Vec3Int]] =
    for {
      attributes <- readSegmentIndexFileAttributes(segmentIndexFileKey)
      hashBucketOffsetsArray <- openZarrArray(segmentIndexFileKey, keyHashBucketOffsets)
      bucketIndex = attributes.applyHashFunction(segmentId) % attributes.nHashBuckets
      bucketRange <- hashBucketOffsetsArray.readAsMultiArray(offset = bucketIndex, shape = 2)
      bucketStart <- tryo(bucketRange.getLong(0)).toFox
      bucketEnd <- tryo(bucketRange.getLong(1)).toFox
      hashBucketExists = bucketEnd - bucketStart != 0
      topLeftsOpt <- Fox.runIf(hashBucketExists)(readTopLefts(segmentIndexFileKey, bucketStart, bucketEnd, segmentId))
    } yield topLeftsOpt.getOrElse(Array.empty)

  private def readTopLefts(segmentIndexFileKey: SegmentIndexFileKey,
                           bucketStart: Long,
                           bucketEnd: Long,
                           segmentId: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Array[Vec3Int]] =
    for {
      attributes <- readSegmentIndexFileAttributes(segmentIndexFileKey)
      hashBucketsArray <- openZarrArray(segmentIndexFileKey, keyHashBuckets)
      topLeftsArray <- openZarrArray(segmentIndexFileKey, keyTopLefts)
      bucket <- hashBucketsArray.readAsMultiArray(offset = Array(bucketStart, 0),
                                                  shape = Array((bucketEnd - bucketStart + 1).toInt, 3))
      bucketLocalOffset <- findLocalOffsetInBucket(bucket, segmentId).toFox ?~> s"SegmentId $segmentId not in bucket list"
      topLeftOpts <- Fox.runIf(bucketLocalOffset >= 0)(for {
        topLeftStart <- tryo(bucket.getLong(bucket.getIndex.set(Array(bucketLocalOffset, 1)))).toFox
        topLeftEnd <- tryo(bucket.getLong(bucket.getIndex.set(Array(bucketLocalOffset, 2)))).toFox
        topLeftCount = (topLeftEnd - topLeftStart).toInt
        _ <- Fox
          .fromBool(attributes.dtypeBucketEntries == "uint16") ?~> "value for dtype_bucket_entries in segment index file is not supported, only uint16 is supported"
        topLeftsMA <- topLeftsArray.readAsMultiArray(offset = Array(topLeftStart, 0), shape = Array(topLeftCount, 3))
        topLefts <- tryo((0 until topLeftCount).map { idx =>
          Vec3Int(
            topLeftsMA.getShort(topLeftsMA.getIndex.set(Array(idx, 0))),
            topLeftsMA.getShort(topLeftsMA.getIndex.set(Array(idx, 1))),
            topLeftsMA.getShort(topLeftsMA.getIndex.set(Array(idx, 2)))
          )
        }.toArray).toFox
      } yield topLefts)
    } yield topLeftOpts.getOrElse(Array.empty)

  private def findLocalOffsetInBucket(bucket: MultiArray, segmentId: Long): Option[Int] =
    (0 until bucket.getShape()(0)).find(idx => bucket.getLong(bucket.getIndex.set(Array(idx, 0))) == segmentId)

  private def openZarrArray(segmentIndexFileKey: SegmentIndexFileKey,
                            zarrArrayName: String)(implicit ec: ExecutionContext, tc: TokenContext): Fox[DatasetArray] =
    openArraysCache.getOrLoad((segmentIndexFileKey, zarrArrayName),
                              _ => openZarrArrayImpl(segmentIndexFileKey, zarrArrayName))

  private def openZarrArrayImpl(segmentIndexFileKey: SegmentIndexFileKey, zarrArrayName: String)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[DatasetArray] =
    for {
      groupVaultPath <- remoteSourceDescriptorService.vaultPathFor(segmentIndexFileKey.attachment)
      zarrArray <- Zarr3Array.open(groupVaultPath / zarrArrayName,
                                   DataSourceId("dummy", "unused"),
                                   "layer",
                                   None,
                                   None,
                                   None,
                                   chunkCacheService.sharedChunkContentsCache)
    } yield zarrArray

}
