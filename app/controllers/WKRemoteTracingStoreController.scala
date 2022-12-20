package controllers

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.tracingstore.TracingUpdatesReport

import javax.inject.Inject
import models.analytics.{AnalyticsService, UpdateAnnotationEvent, UpdateAnnotationViewOnlyEvent}
import models.annotation.AnnotationState._
import models.annotation.{Annotation, AnnotationDAO, AnnotationInformationProvider, TracingStoreService}
import models.binary.{DataSetDAO, DataSetService}
import models.organization.OrganizationDAO
import models.user.UserDAO
import models.user.time.TimeSpanService
import oxalis.security.{WebknossosBearerTokenAuthenticatorService, WkSilhouetteEnvironment}
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}

import scala.concurrent.ExecutionContext

class WKRemoteTracingStoreController @Inject()(
    tracingStoreService: TracingStoreService,
    wkSilhouetteEnvironment: WkSilhouetteEnvironment,
    timeSpanService: TimeSpanService,
    dataSetService: DataSetService,
    organizationDAO: OrganizationDAO,
    userDAO: UserDAO,
    annotationInformationProvider: AnnotationInformationProvider,
    analyticsService: AnalyticsService,
    dataSetDAO: DataSetDAO,
    annotationDAO: AnnotationDAO)(implicit ec: ExecutionContext, playBodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  val bearerTokenService: WebknossosBearerTokenAuthenticatorService =
    wkSilhouetteEnvironment.combinedAuthenticatorService.tokenAuthenticatorService

  def handleTracingUpdateReport(name: String, key: String): Action[TracingUpdatesReport] =
    Action.async(validateJson[TracingUpdatesReport]) { implicit request =>
      implicit val ctx: DBAccessContext = GlobalAccessContext
      tracingStoreService.validateAccess(name, key) { _ =>
        val report = request.body
        for {
          annotation <- annotationDAO.findOneByTracingId(report.tracingId)
          _ <- ensureAnnotationNotFinished(annotation)
          _ <- Fox.runOptional(report.statistics) { statistics =>
            annotationDAO.updateStatistics(annotation._id, statistics)
          }
          _ <- annotationDAO.updateModified(annotation._id, Instant.now)
          userBox <- bearerTokenService.userForTokenOpt(report.userToken).futureBox
          _ <- Fox.runOptional(userBox)(user => timeSpanService.logUserInteraction(report.timestamps, user, annotation))
          _ <- Fox.runOptional(userBox)(user =>
            Fox.runIf(user._id != annotation._user)(annotationDAO.addContributor(annotation._id, user._id)))
          _ = userBox.map { user =>
            userDAO.updateLastActivity(user._id)
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

  def dataSourceForTracing(name: String, key: String, tracingId: String): Action[AnyContent] =
    Action.async { implicit request =>
      tracingStoreService.validateAccess(name, key) { _ =>
        implicit val ctx: DBAccessContext = GlobalAccessContext
        for {
          annotation <- annotationInformationProvider.annotationForTracing(tracingId) ?~> s"No annotation for tracing $tracingId"
          dataSet <- dataSetDAO.findOne(annotation._dataSet)
          dataSource <- dataSetService.dataSourceFor(dataSet)
        } yield Ok(Json.toJson(dataSource))
      }
    }

  def dataSourceIdForTracing(name: String, key: String, tracingId: String): Action[AnyContent] =
    Action.async { implicit request =>
      tracingStoreService.validateAccess(name, key) { _ =>
        implicit val ctx: DBAccessContext = GlobalAccessContext
        for {
          annotation <- annotationInformationProvider.annotationForTracing(tracingId) ?~> s"No annotation for tracing $tracingId"
          dataSet <- dataSetDAO.findOne(annotation._dataSet)
          organization <- organizationDAO.findOne(dataSet._organization)
        } yield Ok(Json.toJson(DataSourceId(dataSet.name, organization.name)))
      }
    }

  def dataStoreURIForDataSet(name: String,
                             key: String,
                             organizationName: Option[String],
                             dataSetName: String): Action[AnyContent] =
    Action.async { implicit request =>
      tracingStoreService.validateAccess(name, key) { _ =>
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
          dataStore <- dataSetService.dataStoreFor(dataSet)
        } yield Ok(Json.toJson(dataStore.url))
      }
    }
}
