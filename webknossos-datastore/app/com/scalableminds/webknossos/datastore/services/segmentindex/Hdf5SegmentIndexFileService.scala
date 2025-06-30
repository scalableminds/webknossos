package com.scalableminds.webknossos.datastore.services.segmentindex

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.storage.{CachedHdf5File, Hdf5FileCache}

import java.nio.file.Paths
import javax.inject.Inject
import scala.concurrent.ExecutionContext

class Hdf5SegmentIndexFileService @Inject()(config: DataStoreConfig) extends FoxImplicits {

  private val dataBaseDir = Paths.get(config.Datastore.baseDirectory)

  private lazy val fileHandleCache = new Hdf5FileCache(100)

  def readSegmentIndex(segmentIndexFileKey: SegmentIndexFileKey, segmentId: Long)(
      implicit ec: ExecutionContext): Fox[Array[Vec3Int]] =
    for {
      segmentIndex <- fileHandleCache.getCachedHdf5File(segmentIndexFileKey.attachment)(CachedHdf5File.fromPath).toFox
      nBuckets = segmentIndex.uint64Reader.getAttr("/", "n_hash_buckets")

      bucketIndex = segmentIndex.hashFunction(segmentId) % nBuckets
      bucketOffsets = segmentIndex.uint64Reader.readArrayBlockWithOffset("hash_bucket_offsets", 2, bucketIndex)
      bucketStart = bucketOffsets(0)
      bucketEnd = bucketOffsets(1)

      hashBucketExists = bucketEnd - bucketStart != 0
      topLeftsOpt <- Fox.runIf(hashBucketExists)(readTopLefts(segmentIndex, bucketStart, bucketEnd, segmentId))
      topLefts = topLeftsOpt.flatten
    } yield
      topLefts match {
        case Some(topLefts) => topLefts.flatMap(topLeft => Vec3Int.fromArray(topLeft.map(_.toInt)))
        case None           => Array.empty
      }

  private def readTopLefts(segmentIndex: CachedHdf5File, bucketStart: Long, bucketEnd: Long, segmentId: Long)(
      implicit ec: ExecutionContext): Fox[Option[Array[Array[Short]]]] =
    for {
      _ <- Fox.successful(())
      buckets = segmentIndex.uint64Reader.readMatrixBlockWithOffset("hash_buckets",
                                                                    (bucketEnd - bucketStart + 1).toInt,
                                                                    3,
                                                                    bucketStart,
                                                                    0)
      bucketLocalOffset = buckets.map(_(0)).indexOf(segmentId)
      topLeftOpts <- Fox.runIf(bucketLocalOffset >= 0)(for {
        _ <- Fox.successful(())
        topLeftStart = buckets(bucketLocalOffset)(1)
        topLeftEnd = buckets(bucketLocalOffset)(2)
        bucketEntriesDtype <- tryo(segmentIndex.stringReader.getAttr("/", "dtype_bucket_entries")).toFox
        _ <- Fox
          .fromBool(bucketEntriesDtype == "uint16") ?~> "value for dtype_bucket_entries in segment index file is not supported, only uint16 is supported"
        topLefts = segmentIndex.uint16Reader.readMatrixBlockWithOffset("top_lefts",
                                                                       (topLeftEnd - topLeftStart).toInt,
                                                                       3,
                                                                       topLeftStart,
                                                                       0)
      } yield topLefts)
    } yield topLeftOpts

  def clearCache(dataSourceId: DataSourceId, layerNameOpt: Option[String]): Int = {
    val datasetPath = dataBaseDir.resolve(dataSourceId.organizationId).resolve(dataSourceId.directoryName)
    val relevantPath = layerNameOpt.map(l => datasetPath.resolve(l)).getOrElse(datasetPath)
    fileHandleCache.clear(key => key.startsWith(relevantPath.toString))
  }
}
