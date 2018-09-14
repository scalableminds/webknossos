package controllers

import javax.inject.Inject
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{InboxDataSourceLike => InboxDataSource}
import com.scalableminds.webknossos.datastore.services.DataStoreStatus
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import models.annotation.{Annotation, AnnotationDAO}
import models.binary._
import models.user.time.TimeSpanService
import play.api.libs.json.{JsError, JsObject, JsSuccess}
import models.annotation.AnnotationState._
import oxalis.security.{WkEnv, WkSilhouetteEnvironment}
import com.mohiva.play.silhouette.api.Silhouette

import scala.concurrent.{ExecutionContext, Future}

class WKDataStoreController @Inject()(dataSetService: DataSetService,
                                      dataStoreService: DataStoreService,
                                      annotationDAO: AnnotationDAO,
                                      dataStoreDAO: DataStoreDAO,
                                      timeSpanService: TimeSpanService,
                                      wkSilhouetteEnvironment: WkSilhouetteEnvironment,
                                      sil: Silhouette[WkEnv])
                                     (implicit ec: ExecutionContext)
  extends Controller
    with LazyLogging {

  val bearerTokenService = wkSilhouetteEnvironment.combinedAuthenticatorService.tokenAuthenticatorService

  def validateDataSetUpload(name: String) = Action.async(parse.json) { implicit request =>
    dataStoreService.validateAccess(name) { dataStore =>
      for {
        uploadInfo <- request.body.validate[DataSourceId].asOpt.toFox ?~> "dataStore.upload.invalid"
        _ <- bool2Fox(dataSetService.isProperDataSetName(uploadInfo.name)) ?~> "dataSet.name.invalid"
        _ <- dataSetService.assertNewDataSetName(uploadInfo.name)(GlobalAccessContext) ?~> "dataSet.name.alreadyTaken"
        _ <- bool2Fox(uploadInfo.team.nonEmpty) ?~> "team.invalid"
      } yield Ok
    }
  }

  def statusUpdate(name: String) = Action.async(parse.json) { implicit request =>
    dataStoreService.validateAccess(name) { dataStore =>
      request.body.validate[DataStoreStatus] match {
        case JsSuccess(status, _) =>
          logger.debug(s"Status update from data store '$name'. Status: " + status.ok)
          dataStoreDAO.updateUrlByName(name, status.url)(GlobalAccessContext).map(_ => Ok)
        case e: JsError =>
          logger.error("Data store '$name' sent invalid update. Error: " + e)
          Future.successful(JsonBadRequest(JsError.toJson(e)))
      }
    }
  }

  def updateAll(name: String) = Action.async(parse.json) { implicit request =>
    dataStoreService.validateAccess(name) { dataStore =>
      request.body.validate[List[InboxDataSource]] match {
        case JsSuccess(dataSources, _) =>
          for {
            _ <- dataSetService.deactivateUnreportedDataSources(dataStore.name, dataSources)(GlobalAccessContext)
            _ <- dataSetService.updateDataSources(dataStore, dataSources)(GlobalAccessContext)
          } yield {
            JsonOk
          }

        case e: JsError =>
          logger.warn("Data store reported invalid json for data sources.")
          Fox.successful(JsonBadRequest(JsError.toJson(e)))
      }
    }
  }

  def updateOne(name: String) = Action.async(parse.json) { implicit request =>
    dataStoreService.validateAccess(name) { dataStore =>
      request.body.validate[InboxDataSource] match {
        case JsSuccess(dataSource, _) =>
          for {
            _ <- dataSetService.updateDataSources(dataStore, List(dataSource))(GlobalAccessContext)
          } yield {
            JsonOk
          }
        case e: JsError =>
          logger.warn("Data store reported invalid json for data source.")
          Fox.successful(JsonBadRequest(JsError.toJson(e)))
      }
    }
  }

  def handleTracingUpdateReport(name: String) = Action.async(parse.json) { implicit request =>
    dataStoreService.validateAccess(name) { dataStore =>
      for {
        tracingId <- (request.body \ "tracingId").asOpt[String].toFox
        annotation <- annotationDAO.findOneByTracingId(tracingId)(GlobalAccessContext)
        _ <- ensureAnnotationNotFinished(annotation)
        timestamps <- (request.body \ "timestamps").asOpt[List[Long]].toFox
        statisticsOpt = (request.body \ "statistics").asOpt[JsObject]
        userTokenOpt = (request.body \ "userToken").asOpt[String]
        _ <- statisticsOpt match {
          case Some(statistics) => annotationDAO.updateStatistics(annotation._id, statistics)(GlobalAccessContext)
          case None => Fox.successful(())
        }
        _ <- annotationDAO.updateModified(annotation._id, System.currentTimeMillis)(GlobalAccessContext)
        userBox <- bearerTokenService.userForTokenOpt(userTokenOpt)(GlobalAccessContext).futureBox
        _ <- Fox.runOptional(userBox)(user => timeSpanService.logUserInteraction(timestamps, user, annotation)(GlobalAccessContext))
      } yield {
        Ok
      }
    }
  }

  private def ensureAnnotationNotFinished(annotation: Annotation) = {
    if (annotation.state == Finished) Fox.failure("annotation already finshed")
    else Fox.successful(())
  }
}
