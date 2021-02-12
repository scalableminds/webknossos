package controllers

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import javax.inject.Inject
import models.analytics.{AnalyticsService, IsosurfaceRequestEvent}
import models.annotation.AnnotationState._
import models.annotation.{Annotation, AnnotationDAO, TracingStoreService}
import models.binary.{DataSetDAO, DataSetService}
import models.team.OrganizationDAO
import models.user.time.TimeSpanService
import oxalis.security.{WebknossosBearerTokenAuthenticatorService, WkSilhouetteEnvironment}
import play.api.i18n.Messages
import play.api.libs.json.{JsObject, JsValue, Json}
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.ExecutionContext

class WKTracingStoreController @Inject()(tracingStoreService: TracingStoreService,
                                         wkSilhouetteEnvironment: WkSilhouetteEnvironment,
                                         timeSpanService: TimeSpanService,
                                         dataSetService: DataSetService,
                                         organizationDAO: OrganizationDAO,
                                         analyticsService: AnalyticsService,
                                         dataSetDAO: DataSetDAO,
                                         annotationDAO: AnnotationDAO)(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  val bearerTokenService: WebknossosBearerTokenAuthenticatorService =
    wkSilhouetteEnvironment.combinedAuthenticatorService.tokenAuthenticatorService

  def handleTracingUpdateReport(name: String): Action[JsValue] = Action.async(parse.json) { implicit request =>
    tracingStoreService.validateAccess(name) { _ =>
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
        _ <- Fox.runOptional(userBox)(user => analyticsService.track(UpdateAnnotationEvent(user, annotation)))
      } yield {
        Ok
      }
    }
  }

  def reportIsosurfaceRequest(name: String, token: Option[String]): Action[AnyContent] = Action.async {
    implicit request =>
      tracingStoreService.validateAccess(name) { _ =>
        for {
          userOpt <- Fox.runOptional(token)(bearerTokenService.userForToken(_)(GlobalAccessContext))
          _ = userOpt.map(user => analyticsService.track(IsosurfaceRequestEvent(user, "annotation")))
        } yield Ok
      }
  }

  private def ensureAnnotationNotFinished(annotation: Annotation) =
    if (annotation.state == Finished) Fox.failure("annotation already finshed")
    else Fox.successful(())

  def dataSource(name: String, organizationName: Option[String], dataSetName: String): Action[AnyContent] =
    Action.async { implicit request =>
      tracingStoreService.validateAccess(name) { _ =>
        implicit val ctx: DBAccessContext = GlobalAccessContext
        for {
          organizationIdOpt <- Fox.runOptional(organizationName) {
            organizationDAO.findOneByName(_)(GlobalAccessContext).map(_._id)
          } ?~> Messages("organization.notFound", organizationName.getOrElse("")) ~> NOT_FOUND
          organizationId <- Fox.fillOption(organizationIdOpt) {
            dataSetDAO.getOrganizationForDataSet(dataSetName)(GlobalAccessContext)
          } ?~> Messages("dataSet.noAccess", dataSetName) ~> FORBIDDEN
          dataSet <- dataSetDAO.findOneByNameAndOrganization(dataSetName, organizationId) ?~> Messages(
            "dataSet.noAccess",
            dataSetName) ~> FORBIDDEN
          dataSource <- dataSetService.dataSourceFor(dataSet)
        } yield Ok(Json.toJson(dataSource))
      }
    }
}
