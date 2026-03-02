package com.scalableminds.webknossos.datastore.controllers

import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.helpers.NativeBucketScanner
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import com.scalableminds.webknossos.datastore.services.ApplicationHealthService
import com.scalableminds.webknossos.datastore.storage.DataStoreRedisStore
import com.scalableminds.util.tools.Box.tryo

import javax.inject.Inject
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.ExecutionContext

class Application @Inject()(redisClient: DataStoreRedisStore, applicationHealthService: ApplicationHealthService)(
    implicit ec: ExecutionContext)
    extends Controller {

  override def allowRemoteOrigin: Boolean = true

  def health: Action[AnyContent] = Action.async { implicit request =>
    log() {
      for {
        before <- Instant.nowFox
        _ <- redisClient.checkHealth
        afterRedis = Instant.now
        _ <- Fox.fromBool(applicationHealthService.getRecentProblem().isEmpty) ?~> "Java Internal Errors detected"
        _ <- testNativeBucketScanner.toFox ?~> "NativeBucketScanner error"
        _ = logger.info(
          s"Answering ok for Datastore health check, took ${formatDuration(afterRedis - before)} (Redis at ${redisClient.authority} ${formatDuration(
            afterRedis - before)})")
      } yield Ok("Ok")
    }
  }

  // Test that the NativeBucketScanner works.
  // The result is stored in a val because we expect that this continues to work if it works on startup.
  private lazy val testNativeBucketScanner = tryo {
    val elementClass = ElementClass.uint16
    // little endian uint16 representation of 2, 4, 500, 500
    val array = Array[Byte](2, 0, 4, 0, 244.toByte, 1, 244.toByte, 1)
    val scanner = new NativeBucketScanner()
    val segmentIds = scanner.collectSegmentIds(array,
                                               ElementClass.bytesPerElement(elementClass),
                                               ElementClass.isSigned(elementClass),
                                               skipZeroes = false)
    val expected = Array[Long](2, 4, 500)
    if (!segmentIds.sorted.sameElements(expected)) {
      throw new IllegalStateException(
        s"NativeBucketScanner did not scan segment ids of test array correctly. Expected ${expected
          .mkString(",")}, got ${segmentIds.mkString(",")}")
    }
  }

  def testLoadingS3Chunks: Action[AnyContent] = Action.async { implicit request =>
    val path = UPath.fromStringUnsafe(
      "s3://fsn1.your-objectstorage.com/webknossos-wkorg-0002/7c9243814eeed5e6/ZF_retina_opl_ipl_model_v5_segmentation_v1-6904132501000035025c5d64/segmentation/agglomerates/agglomerate_view_70/segment_to_agglomerate/c/0")
    val chunkLength = 5000
    for {
      vaultPath <- dataVaultService.vaultPathFor(path)
      before = Instant.now
      _ <- Fox.batchSerialCombined((0 until 200), batchSize = 20) { i =>
        val byteRange = ByteRange.startEndExclusive(i * chunkLength, (i + 1) * chunkLength)
        val before = Instant.now
        for {
          _ <- vaultPath.readBytes(byteRange)
          _ = Instant.logSince(before, s"loading $chunkLength bytes", logger)
        } yield ()
      }
      _ = Instant.logSince(before, "whole test", logger)
    } yield Ok
  }

}
