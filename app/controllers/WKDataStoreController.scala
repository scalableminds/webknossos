package controllers

import javax.inject.Inject
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{InboxDataSourceLike => InboxDataSource}
import com.scalableminds.webknossos.datastore.services.DataStoreStatus
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import models.binary._
import play.api.libs.json.{JsError, JsObject, JsSuccess}
import models.annotation.AnnotationState._
import models.team.OrganizationDAO
import oxalis.security.{WkEnv, WkSilhouetteEnvironment}
import com.mohiva.play.silhouette.api.Silhouette

import scala.concurrent.{ExecutionContext, Future}

class WKDataStoreController @Inject()(dataSetService: DataSetService,
                                      dataStoreService: DataStoreService,
                                      dataStoreDAO: DataStoreDAO,
                                      organizationDAO: OrganizationDAO,
                                      sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with LazyLogging {

  def validateDataSetUpload(name: String) = Action.async(parse.json) { implicit request =>
    dataStoreService.validateAccess(name) { dataStore =>
      for {
        uploadInfo <- request.body.validate[DataSourceId].asOpt.toFox ?~> "dataStore.upload.invalid"
        organization <- organizationDAO
          .findOneByName(uploadInfo.team)(GlobalAccessContext) ?~> "organization.notFound" ~> NOT_FOUND
        _ <- bool2Fox(dataSetService.isProperDataSetName(uploadInfo.name)) ?~> "dataSet.name.invalid"
        _ <- dataSetService
          .assertNewDataSetName(uploadInfo.name, organization._id)(GlobalAccessContext) ?~> "dataSet.name.alreadyTaken"
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
            existingIds <- dataSetService.updateDataSources(dataStore, dataSources)(GlobalAccessContext)
            _ <- dataSetService.deactivateUnreportedDataSources(existingIds)(GlobalAccessContext)
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
}
