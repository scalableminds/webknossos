package controllers

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.tracingstore.TracingUpdatesReport
import javax.inject.Inject
import models.analytics.{AnalyticsService, UpdateAnnotationEvent, UpdateAnnotationViewOnlyEvent}
import models.annotation.AnnotationState._
import models.annotation.{Annotation, AnnotationDAO, TracingStoreService}
import models.binary.{DataSetDAO, DataSetService}
import models.organization.OrganizationDAO
import models.user.time.TimeSpanService
import oxalis.security.{WebknossosBearerTokenAuthenticatorService, WkSilhouetteEnvironment}
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}

import scala.concurrent.ExecutionContext

class WKTracingStoreController @Inject()(
    tracingStoreService: TracingStoreService,
    wkSilhouetteEnvironment: WkSilhouetteEnvironment,
    timeSpanService: TimeSpanService,
    dataSetService: DataSetService,
    organizationDAO: OrganizationDAO,
    analyticsService: AnalyticsService,
    dataSetDAO: DataSetDAO,
    annotationDAO: AnnotationDAO)(implicit ec: ExecutionContext, playBodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  val bearerTokenService: WebknossosBearerTokenAuthenticatorService =
    wkSilhouetteEnvironment.combinedAuthenticatorService.tokenAuthenticatorService

  def handleTracingUpdateReport(name: String): Action[TracingUpdatesReport] =
    Action.async(validateJson[TracingUpdatesReport]) { implicit request =>
      tracingStoreService.validateAccess(name) { _ =>
        val report = request.body
        for {
          annotation <- annotationDAO.findOneByTracingId(report.tracingId)(GlobalAccessContext)
          _ <- ensureAnnotationNotFinished(annotation)
          _ <- Fox.runOptional(report.statistics) { statistics =>
            annotationDAO.updateStatistics(annotation._id, statistics)(GlobalAccessContext)
          }
          _ <- annotationDAO.updateModified(annotation._id, System.currentTimeMillis)(GlobalAccessContext)
          userBox <- bearerTokenService.userForTokenOpt(report.userToken)(GlobalAccessContext).futureBox
          _ <- Fox.runOptional(userBox)(user =>
            timeSpanService.logUserInteraction(report.timestamps, user, annotation)(GlobalAccessContext))
          _ = userBox.map { user =>
            if (report.significantChangesCount > 0) {
              analyticsService.track(UpdateAnnotationEvent(user, annotation, report.significantChangesCount))
            }
            if (report.viewChangesCount > 0) {
              analyticsService.track(UpdateAnnotationViewOnlyEvent(user, annotation, report.viewChangesCount))
            }
          }
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
