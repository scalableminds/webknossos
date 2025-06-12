package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Float
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.datareaders.DatasetArray
import com.scalableminds.webknossos.datastore.datareaders.zarr3.{Zarr3Array, Zarr3GroupHeader}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.services.{ChunkCacheService, Hdf5HashedArrayUtils}
import net.liftweb.common.Box.tryo
import play.api.libs.json.{Json, OFormat}
import ucar.ma2.{Array => MultiArray}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class MeshfileAttributes(
    mesh_format: String,
    lod_scale_multiplier: Double,
    transform: Array[Array[Double]],
    hash_function: String,
    n_buckets: Int // TODO camelCase + custom format?
) extends Hdf5HashedArrayUtils {
  lazy val applyHashFunction: Long => Long = getHashFunction(hash_function)
}

object MeshfileAttributes {
  implicit val jsonFormat: OFormat[MeshfileAttributes] = Json.format[MeshfileAttributes]
}

class ZarrMeshFileService @Inject()(chunkCacheService: ChunkCacheService)
    extends FoxImplicits
    with NeuroglancerMeshHelper {

  private val keyBucketOffsets = "bucket_offsets"
  private val keyBuckets = "buckets"
  private val keyNeuroglancer = "neuroglancer"

  def readMeshfileMetadata(meshFilePath: VaultPath)(implicit ec: ExecutionContext,
                                                    tc: TokenContext): Fox[(String, Double, Array[Array[Double]])] =
    for {
      groupHeaderBytes <- (meshFilePath / Zarr3GroupHeader.FILENAME_ZARR_JSON).readBytes()
      groupHeader <- JsonHelper.parseAs[Zarr3GroupHeader](groupHeaderBytes).toFox ?~> "Could not parse array header"
      meshfileAttributes <- groupHeader.meshfileAttributes.toFox ?~> "Could not parse meshfile attributes from zarr group file"
    } yield (meshfileAttributes.mesh_format, meshfileAttributes.lod_scale_multiplier, meshfileAttributes.transform)

  def listMeshChunksForSegment(meshFilePath: VaultPath, segmentId: Long, meshfileAttributes: MeshfileAttributes)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[MeshLodInfo]] =
    for {
      (neuroglancerSegmentManifestStart, neuroglancerSegmentManifestEnd) <- getNeuroglancerSegmentManifestOffsets(
        meshFilePath,
        meshfileAttributes,
        segmentId)
      neuroglancerArray <- openZarrArray(meshFilePath, keyNeuroglancer)
      manifestBytes <- neuroglancerArray.readAsMultiArray(
        offset = neuroglancerSegmentManifestStart,
        shape = (neuroglancerSegmentManifestEnd - neuroglancerSegmentManifestStart).toInt)
      segmentManifest <- tryo(NeuroglancerSegmentManifest.fromBytes(manifestBytes.getStorage.asInstanceOf[Array[Byte]])).toFox
    } yield
      enrichSegmentInfo(segmentManifest,
                        meshfileAttributes.lod_scale_multiplier,
                        meshfileAttributes.transform,
                        neuroglancerSegmentManifestStart,
                        segmentId)

  private def getNeuroglancerSegmentManifestOffsets(
      meshFilePath: VaultPath,
      meshfileAttributes: MeshfileAttributes,
      segmentId: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[(Long, Long)] = {
    val bucketIndex = meshfileAttributes.applyHashFunction(segmentId) % meshfileAttributes.n_buckets
    for {
      bucketOffsetsArray <- openZarrArray(meshFilePath, keyBucketOffsets)
      bucketRange <- bucketOffsetsArray.readAsMultiArray(offset = bucketIndex, shape = 2)
      bucketStart <- tryo(bucketRange.getLong(0)).toFox
      bucketEnd <- tryo(bucketRange.getLong(1)).toFox
      bucketSize = (bucketEnd - bucketStart).toInt
      _ <- Fox.fromBool(bucketSize > 0) ?~> s"No entry for segment $segmentId"
      bucketsArray <- openZarrArray(meshFilePath, keyBuckets)
      bucket <- bucketsArray.readAsMultiArray(offset = Array(bucketStart, 0), shape = Array(bucketSize + 1, 3))
      bucketLocalOffset <- findLocalOffsetInBucket(bucket, segmentId).toFox
      _ <- Fox.fromBool(bucketLocalOffset >= 0) ?~> s"SegmentId $segmentId not in bucket list"
      neuroglancerStart = bucket.getLong(bucket.getIndex.set(Array(bucketLocalOffset, 1)))
      neuroglancerEnd = bucket.getLong(bucket.getIndex.set(Array(bucketLocalOffset, 2)))
    } yield (neuroglancerStart, neuroglancerEnd)
  }

  private def findLocalOffsetInBucket(bucket: MultiArray, segmentId: Long): Option[Int] =
    (0 until (bucket.getShape()(0))).find(idx => bucket.getLong(bucket.getIndex.set(Array(idx, 0))) == segmentId)

  private def openZarrArray(meshFilePath: VaultPath, zarrArrayName: String)(implicit ec: ExecutionContext,
                                                                            tc: TokenContext): Fox[DatasetArray] = {
    val arrayPath = meshFilePath / zarrArrayName
    for {
      zarrArray <- Zarr3Array.open(arrayPath,
                                   DataSourceId("dummy", "unused"),
                                   "layer",
                                   None,
                                   None,
                                   None,
                                   chunkCacheService.sharedChunkContentsCache)
    } yield zarrArray
  }

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
}
