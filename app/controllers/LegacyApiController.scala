package controllers

import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import play.silhouette.api.Silhouette
import play.silhouette.api.actions.SecuredRequest
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.tracingstore.tracings.volume.MagRestrictions
import models.dataset.{DatasetDAO, DatasetService}
import models.organization.OrganizationDAO

import javax.inject.Inject
import models.task.{BaseAnnotation, TaskParameters}
import models.user.{Experience, User}
import net.liftweb.common.Box.tryo
import play.api.http.HttpEntity
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent, PlayBodyParsers, Result}
import security.WkEnv
import com.scalableminds.util.objectid.ObjectId

import scala.concurrent.ExecutionContext

case class LegacyCreateExplorationalParameters(typ: String,
                                               fallbackLayerName: Option[String],
                                               resolutionRestrictions: Option[MagRestrictions])
object LegacyCreateExplorationalParameters {
  implicit val jsonFormat: OFormat[LegacyCreateExplorationalParameters] =
    Json.format[LegacyCreateExplorationalParameters]
}

case class LegacyTaskParameters(taskTypeId: String,
                                neededExperience: Experience,
                                pendingInstances: Int,
                                projectName: String,
                                scriptId: Option[String],
                                boundingBox: Option[BoundingBox],
                                dataSet: String,
                                datasetId: Option[ObjectId],
                                editPosition: Vec3Int,
                                editRotation: Vec3Double,
                                creationInfo: Option[String],
                                description: Option[String],
                                baseAnnotation: Option[BaseAnnotation])

object LegacyTaskParameters {
  implicit val taskParametersFormat: Format[LegacyTaskParameters] = Json.format[LegacyTaskParameters]
}

class LegacyApiController @Inject()(annotationController: AnnotationController,
                                    datasetController: DatasetController,
                                    projectController: ProjectController,
                                    taskController: TaskController,
                                    organizationDAO: OrganizationDAO,
                                    datasetService: DatasetService,
                                    datasetDAO: DatasetDAO,
                                    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller {

  /* provide v8 */

  def isValidNewNameV8(datasetName: String, organizationId: String): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        _ <- Fox.successful(logVersioned(request))
        result <- datasetController.isValidNewName(datasetName)(request)
      } yield result
  }

  def readDatasetV8(organizationId: String, datasetName: String, sharingToken: Option[String]): Action[AnyContent] =
    sil.UserAwareAction.async { implicit request =>
      for {
        dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, organizationId)
        result <- datasetController.read(dataset._id, sharingToken)(request)
        adaptedResult <- replaceInResult(migrateDatasetJsonToOldFormat)(result)
      } yield adaptedResult
    }

  def updateDatasetV8(organizationId: String, datasetName: String): Action[JsValue] =
    sil.SecuredAction.async(parse.json) { implicit request =>
      for {
        _ <- Fox.successful(logVersioned(request))
        dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, organizationId)
        result <- datasetController.update(dataset._id)(request)
        adaptedResult <- replaceInResult(migrateDatasetJsonToOldFormat)(result)
      } yield adaptedResult
    }

  def updateDatasetTeamsV8(organizationId: String, datasetName: String): Action[List[ObjectId]] =
    sil.SecuredAction.async(validateJson[List[ObjectId]]) { implicit request =>
      for {
        _ <- Fox.successful(logVersioned(request))
        dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, organizationId)
        result <- datasetController.updateTeams(dataset._id)(request)
      } yield result
    }

  def getDatasetSharingTokenV8(organizationId: String, datasetName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- Fox.successful(logVersioned(request))
        dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, organizationId)
        sharingToken <- datasetController.getSharingToken(dataset._id)(request)
      } yield sharingToken
    }

  def readTaskV8(taskId: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- Fox.successful(logVersioned(request))
      result <- taskController.read(taskId)(request)
      adaptedResult <- replaceInResult(addLegacyDataSetFieldToTask)(result)
    } yield adaptedResult
  }

  def createTaskV8: Action[List[LegacyTaskParameters]] =
    sil.SecuredAction.async(validateJson[List[LegacyTaskParameters]]) { implicit request =>
      for {
        taskParametersWithDatasetId <- Fox.serialCombined(request.body)(params =>
          for {
            dataset <- datasetDAO.findOneByIdOrNameAndOrganization(params.datasetId,
                                                                   params.dataSet,
                                                                   request.identity._organization)
          } yield TaskParameters.fromLegacyTaskParameters(params, dataset._id))
        requestWithUpdatedBody = request.withBody(taskParametersWithDatasetId)
        result <- taskController.create()(requestWithUpdatedBody)
        adaptedResult <- replaceInResult(addLegacyDataSetFieldToTaskCreationResult)(result)
      } yield adaptedResult
    }

  def updateTaskV8(taskId: ObjectId): Action[LegacyTaskParameters] =
    sil.SecuredAction.async(validateJson[LegacyTaskParameters]) { implicit request =>
      val params = request.body
      for {
        dataset <- datasetDAO.findOneByIdOrNameAndOrganization(params.datasetId,
                                                               params.dataSet,
                                                               request.identity._organization)
        paramsWithDatasetId = TaskParameters.fromLegacyTaskParameters(params, dataset._id)
        requestWithUpdatedBody = request.withBody(paramsWithDatasetId)
        result <- taskController.update(taskId)(requestWithUpdatedBody)
        adaptedResult <- replaceInResult(addLegacyDataSetFieldToTask)(result)
      } yield adaptedResult
    }

  def tasksForProjectV8(id: ObjectId,
                        limit: Option[Int] = None,
                        pageNumber: Option[Int] = None,
                        includeTotalCount: Option[Boolean]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- Fox.successful(logVersioned(request))
        result <- projectController.tasksForProject(id, limit, pageNumber, includeTotalCount)(request)
        replacedResults <- replaceInResult(addLegacyDataSetFieldToTask)(result)
      } yield replacedResults
    }

  /* provide v7 */

  def listDatasetsV7(isActive: Option[Boolean],
                     isUnreported: Option[Boolean],
                     organizationName: Option[String],
                     onlyMyOrganization: Option[Boolean],
                     uploaderId: Option[ObjectId],
                     folderId: Option[ObjectId],
                     includeSubfolders: Option[Boolean],
                     searchQuery: Option[String],
                     limit: Option[Int],
                     compact: Option[Boolean]): Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    datasetController.list(isActive,
                           isUnreported,
                           organizationName,
                           onlyMyOrganization,
                           uploaderId,
                           folderId,
                           includeSubfolders,
                           searchQuery,
                           limit,
                           compact)(request)
  }

  /* provide v6 */

  def listDatasetsV6(isActive: Option[Boolean],
                     isUnreported: Option[Boolean],
                     organizationName: Option[String],
                     onlyMyOrganization: Option[Boolean],
                     uploaderId: Option[ObjectId],
                     folderId: Option[ObjectId],
                     includeSubfolders: Option[Boolean],
                     searchQuery: Option[String],
                     limit: Option[Int],
                     compact: Option[Boolean]): Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    for {
      result <- datasetController.list(isActive,
                                       isUnreported,
                                       organizationName,
                                       onlyMyOrganization,
                                       uploaderId,
                                       folderId,
                                       includeSubfolders,
                                       searchQuery,
                                       limit,
                                       compact)(request)
      adaptedResult <- replaceInResult(replaceVoxelSize)(result)
    } yield adaptedResult
  }

  def readDatasetV6(organizationName: String, datasetName: String, sharingToken: Option[String]): Action[AnyContent] =
    sil.UserAwareAction.async { implicit request =>
      for {
        dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, organizationName)
        result <- datasetController.read(dataset._id, sharingToken)(request)
        adaptedResult <- replaceInResult(replaceVoxelSize)(result)
      } yield adaptedResult
    }

  /* provide v5 */

  def assertValidNewNameV5(organizationName: String, datasetName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        organization <- organizationDAO.findOne(organizationName) // the old organizationName is now the organization id
        _ <- bool2Fox(organization._id == request.identity._organization) ~> FORBIDDEN
        _ <- datasetService.assertValidDatasetName(datasetName)
      } yield Ok
    }

  /* private helper methods for legacy adaptation */

  private def migrateDatasetJsonToOldFormat(jsResult: JsObject): Fox[JsObject] = {
    val datasetName = (jsResult \ "name").asOpt[String]
    val directoryName = (jsResult \ "directoryName").asOpt[String]
    datasetName.zip(directoryName) match {
      case Some((name, dirName)) =>
        for {
          dsWithOldNameField <- tryo(jsResult - "directoryName" + ("name" -> Json.toJson(dirName))).toFox
          dsWithOldDisplayNameField <- tryo(dsWithOldNameField + ("displayName" -> Json.toJson(name))).toFox
        } yield dsWithOldDisplayNameField
      case _ => Fox.successful(jsResult)
    }
  }

  private def addLegacyDataSetFieldToTaskCreationResult(jsResult: JsObject) =
    for {
      tasksResults <- tryo((jsResult \ "tasks").as[List[JsObject]]).toFox
      adaptedTasks <- Fox.serialCombined(tasksResults)(taskResult => {
        (taskResult \ "status").asOpt[JsNumber] match {
          case Some(JsNumber(value)) if value == BigDecimal(200) =>
            for {
              task <- tryo((taskResult \ "success").as[JsObject]).toFox
              adaptedTask <- addLegacyDataSetFieldToTask(task)
              adaptedTaskResult <- tryo(taskResult - "success" + ("success" -> adaptedTask)).toFox
            } yield adaptedTaskResult
          case _ => Fox.successful(taskResult)
        }
      })
      adaptedJsResult <- tryo(jsResult - "tasks" + ("tasks" -> Json.toJson(adaptedTasks))).toFox
    } yield adaptedJsResult

  private def addLegacyDataSetFieldToTask(js: JsObject): Fox[JsObject] =
    tryo(js + ("dataSet" -> (js \ "datasetName").as[JsString]))

  private def replaceVoxelSize(jsObject: JsObject) = {
    val voxelSizeOpt = (jsObject \ "dataSource" \ "scale").asOpt[VoxelSize]
    voxelSizeOpt match {
      case None => Fox.successful(jsObject)
      case Some(voxelSize) =>
        val inNanometer = voxelSize.toNanometer
        for {
          newDataSource <- tryo(
            (jsObject \ "dataSource").as[JsObject] - "scale" + ("scale" -> Json.toJson(inNanometer))).toFox
          newValue <- tryo(jsObject - "dataSource" + ("dataSource" -> newDataSource)).toFox
        } yield newValue
    }
  }

  private def replaceInResult(replacement: JsObject => Fox[JsObject])(result: Result): Fox[Result] =
    if (result.header.status == 200) {
      result.body match {
        case HttpEntity.Strict(data, _) =>
          val bodyJsonValue: JsValue = Json.parse(data.decodeString("utf-8"))
          val newJsonFox: Fox[JsValue] = bodyJsonValue match {
            case JsArray(value) =>
              for { valueList <- Fox.serialCombined(value.toList)(el => replacement(el.as[JsObject])) } yield
                Json.toJson(valueList)
            case jsObj: JsObject => replacement(jsObj)
            case v: JsValue      => Fox.successful(v)
          }
          for {
            newJson <- newJsonFox
          } yield Ok(Json.toJson(newJson)).copy(header = result.header)
        case _ => Fox.successful(BadRequest)
      }
    } else Fox.successful(result)

  private def logVersioned(request: SecuredRequest[WkEnv, _]): Unit =
    logVersioned(request.identity, request.uri)

  private def logVersioned(user: User, uri: String): Unit =
    logger.info(s"Noted usage of legacy route $uri by user ${user._id}")

}
