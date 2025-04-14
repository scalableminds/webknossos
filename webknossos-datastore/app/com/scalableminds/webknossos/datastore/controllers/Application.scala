package com.scalableminds.webknossos.datastore.controllers

import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.helpers.NativeBucketScanner
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import com.scalableminds.webknossos.datastore.services.ApplicationHealthService
import com.scalableminds.webknossos.datastore.storage.DataStoreRedisStore
import net.liftweb.common.Box.tryo

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
        _ <- Fox.bool2Fox(applicationHealthService.getRecentProblem().isEmpty) ?~> "Java Internal Errors detected"
        _ <- testNativeBucketScanner.toFox ?~> "NativeBucketScanner error"
        _ = logger.info(
          s"Answering ok for Datastore health check, took ${formatDuration(afterRedis - before)} (Redis at ${redisClient.authority} ${formatDuration(
            afterRedis - before)})")
      } yield Ok("Ok")
    }
  }

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
          .mkString(",")}, got ${expected.mkString(",")}")
    }
  }

}
