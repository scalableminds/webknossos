package controllers

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import javax.inject.Inject
import models.annotation.{Annotation, AnnotationDAO, TracingStoreService}
import models.user.time.TimeSpanService
import oxalis.security.{WkEnv, WkSilhouetteEnvironment}
import com.mohiva.play.silhouette.api.Silhouette
import play.api.libs.json.{JsObject, Json}
import models.annotation.AnnotationState._
import models.binary.{DataSetDAO, DataSetService}
import models.team.OrganizationDAO
import play.api.i18n.Messages
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.ExecutionContext

class WKTracingStoreController @Inject()(tracingStoreService: TracingStoreService,
                                         wkSilhouetteEnvironment: WkSilhouetteEnvironment,
                                         timeSpanService: TimeSpanService,
                                         dataSetService: DataSetService,
                                         organizationDAO: OrganizationDAO,
                                         dataSetDAO: DataSetDAO,
                                         annotationDAO: AnnotationDAO,
                                         sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  val bearerTokenService = wkSilhouetteEnvironment.combinedAuthenticatorService.tokenAuthenticatorService

  def handleTracingUpdateReport(name: String) = Action.async(parse.json) { implicit request =>
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
      } yield {
        Ok
      }
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
