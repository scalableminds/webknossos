package controllers

import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import javax.inject.Inject
import models.annotation.{Annotation, AnnotationDAO, TracingStoreDAO, TracingStoreService}
import models.user.time.TimeSpanService
import oxalis.security.{WkEnv, WkSilhouetteEnvironment}
import com.mohiva.play.silhouette.api.Silhouette
import play.api.libs.json.{JsObject, Json}
import models.annotation.AnnotationState._

import scala.concurrent.ExecutionContext

class WKTracingStoreController @Inject()(tracingStoreService: TracingStoreService,
                                         tracingStoreDAO: TracingStoreDAO,
                                         wkSilhouetteEnvironment: WkSilhouetteEnvironment,
                                         timeSpanService: TimeSpanService,
                                         annotationDAO: AnnotationDAO,
                                         sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  val bearerTokenService = wkSilhouetteEnvironment.combinedAuthenticatorService.tokenAuthenticatorService

  def listOne = sil.UserAwareAction.async { implicit request =>
    for {
      tracingStore <- tracingStoreDAO.findFirst ?~> "tracingStore.list.failed"
      js <- tracingStoreService.publicWrites(tracingStore)
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def handleTracingUpdateReport(name: String) = Action.async(parse.json) { implicit request =>
    tracingStoreService.validateAccess(name) { dataStore =>
      for {
        tracingId <- (request.body \ "tracingId").asOpt[String].toFox
        annotation <- annotationDAO.findOneByTracingId(tracingId)(GlobalAccessContext)
        _ <- ensureAnnotationNotFinished(annotation)
        timestamps <- (request.body \ "timestamps").asOpt[List[Long]].toFox
        statisticsOpt = (request.body \ "statistics").asOpt[JsObject]
        userTokenOpt = (request.body \ "userToken").asOpt[String]
        _ <- statisticsOpt match {
          case Some(statistics) => annotationDAO.updateStatistics(annotation._id, statistics)(GlobalAccessContext)
          case None             => Fox.successful(())
        }
        _ <- annotationDAO.updateModified(annotation._id, System.currentTimeMillis)(GlobalAccessContext)
        userBox <- bearerTokenService.userForTokenOpt(userTokenOpt)(GlobalAccessContext).futureBox
        _ <- Fox.runOptional(userBox)(user =>
          timeSpanService.logUserInteraction(timestamps, user, annotation)(GlobalAccessContext))
      } yield {
        Ok
      }
    }
  }

  private def ensureAnnotationNotFinished(annotation: Annotation) =
    if (annotation.state == Finished) Fox.failure("annotation already finshed")
    else Fox.successful(())
}
