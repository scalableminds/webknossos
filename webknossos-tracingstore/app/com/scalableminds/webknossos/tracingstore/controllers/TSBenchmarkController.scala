package com.scalableminds.webknossos.tracingstore.controllers

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.controllers.Controller
import com.scalableminds.webknossos.tracingstore.TracingStoreConfig
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeVersioningBenchmarkService
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeVersioningBenchmarkService.Params
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, Result}

import java.security.MessageDigest
import javax.inject.Inject
import scala.concurrent.ExecutionContext

/** SPIKE — exposes the volume versioning benchmark so it can be run against a deployed tracingstore rather than only
  * locally.
  *
  * Gated twice, because a run writes real data into the shared FossilDB and RocksDB compaction amplifies that
  * several-fold:
  *
  *   1. `tracingstore.enableBenchmarkEndpoint` must be true. It defaults to false, so a tracingstore that was not
  *      deliberately configured for benchmarking refuses regardless of credentials. This is the real guard.
  *   2. `?key=` must match `tracingstore.key`, the secret the tracingstore already shares with webKnossos.
  *
  * The usual `UserAccessRequest.webknossos` gate would be stronger, but it requires the webknossos-internal token,
  * which is impractical to obtain for a manual curl. Given the endpoint is off by default, the shared key is the better
  * trade for something driven by hand.
  *
  * Parameters are query parameters so they can be tweaked without redeploying. They are capped in
  * VolumeVersioningBenchmarkService.Params.
  */
class TSBenchmarkController @Inject() (
    benchmarkService: VolumeVersioningBenchmarkService,
    config: TracingStoreConfig
)(implicit ec: ExecutionContext)
    extends Controller {

  override def allowRemoteOrigin: Boolean = true

  private def constantTimeEquals(a: String, b: String): Boolean =
    MessageDigest.isEqual(a.getBytes("UTF-8"), b.getBytes("UTF-8"))

  private def authorized(key: Option[String])(block: => Result): Result =
    if (!config.Tracingstore.enableBenchmarkEndpoint)
      Forbidden(
        Json.obj(
          "error" -> "Benchmark endpoint is disabled. Set tracingstore.enableBenchmarkEndpoint=true to enable it."
        )
      )
    else if (!key.exists(constantTimeEquals(_, config.Tracingstore.key)))
      Forbidden(Json.obj("error" -> "Missing or wrong ?key= (must equal tracingstore.key)."))
    else block

  def volumeVersioning(
      key: Option[String],
      buckets: Option[Int],
      versions: Option[Int],
      snapshotInterval: Option[Int],
      bytesPerVoxel: Option[Int],
      runsPerDiff: Option[Int],
      runLength: Option[Int],
      readRounds: Option[Int]
  ): Action[AnyContent] = Action.fox { implicit request =>
    log() {
      Fox.successful(authorized(key) {
        Params.fromQuery(buckets, versions, snapshotInterval, bytesPerVoxel, runsPerDiff, runLength, readRounds) match {
          case Left(error)   => BadRequest(Json.obj("error" -> error))
          case Right(params) =>
            // Runs synchronously and can take minutes at larger parameters.
            benchmarkService.run(params) match {
              case Left(error)   => InternalServerError(Json.obj("error" -> error))
              case Right(result) => Ok(result)
            }
        }
      })
    }
  }

  /** Sweeps leftovers from a run that was interrupted before it could clean up. */
  def volumeVersioningCleanup(key: Option[String]): Action[AnyContent] = Action.fox { implicit request =>
    log() {
      Fox.successful(authorized(key) {
        benchmarkService.cleanUpStandalone() match {
          case Left(error)      => InternalServerError(Json.obj("error" -> error))
          case Right(remaining) => Ok(Json.obj("ok" -> true, "keysRemaining" -> remaining))
        }
      })
    }
  }
}
