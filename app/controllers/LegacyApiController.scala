package controllers

import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import play.silhouette.api.Silhouette
import play.silhouette.api.actions.SecuredRequest
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.annotation.{AnnotationLayer, AnnotationLayerType}
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

  /* to provide v8, remove legacy routes */

  def readDatasetV8(organizationId: String, datasetName: String, sharingToken: Option[String]): Action[AnyContent] =
    sil.UserAwareAction.async { implicit request =>
      for {
        dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, organizationId)
        result <- datasetController.read(dataset._id.toString, sharingToken)(request)
      } yield result
    }

  def updateDatasetV8(organizationId: String, datasetName: String): Action[JsValue] =
    sil.SecuredAction.async(parse.json) { implicit request =>
      for {
        _ <- Fox.successful(logVersioned(request))
        dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, organizationId)
        result <- datasetController.update(dataset._id.toString)(request)
      } yield result
    }

  def updateDatasetTeamsV8(organizationId: String, datasetName: String): Action[List[ObjectId]] =
    sil.SecuredAction.async(validateJson[List[ObjectId]]) { implicit request =>
      for {
        _ <- Fox.successful(logVersioned(request))
        dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, organizationId)
        result <- datasetController.updateTeams(dataset._id.toString)(request)
      } yield result
    }

  def getDatasetSharingTokenV8(organizationId: String, datasetName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- Fox.successful(logVersioned(request))
        dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, organizationId)
        sharingToken <- datasetController.getSharingToken(dataset._id.toString)(request)
      } yield sharingToken
    }

  def readTaskV8(taskId: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
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

  def updateTaskV8(taskId: String): Action[LegacyTaskParameters] =
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

  def tasksForProjectV8(id: String,
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

  def annotationInfoV8(id: String, timestamp: Long): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- Fox.successful(logVersioned(request))
      result <- annotationController.infoWithoutType(id, timestamp)(request)
      adaptedResult <- replaceInResult(replaceAnnotationLayers)(result)
    } yield adaptedResult
  }

  def annotationsForTaskV8(taskId: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- Fox.successful(logVersioned(request))
        result <- annotationController.annotationsForTask(taskId)(request)
        adaptedResult <- replaceInResult(addDataSetToTaskInAnnotation)(result)
      } yield adaptedResult
    }

  /* to provide v7, remove legacy routes */

  def listDatasetsV7(isActive: Option[Boolean],
                     isUnreported: Option[Boolean],
                     organizationName: Option[String],
                     onlyMyOrganization: Option[Boolean],
                     uploaderId: Option[String],
                     folderId: Option[String],
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

  /* to provide v6, remove legacy routes */

  def listDatasetsV6(isActive: Option[Boolean],
                     isUnreported: Option[Boolean],
                     organizationName: Option[String],
                     onlyMyOrganization: Option[Boolean],
                     uploaderId: Option[String],
                     folderId: Option[String],
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
        result <- datasetController.read(dataset._id.toString, sharingToken)(request)
        adaptedResult <- replaceInResult(replaceVoxelSize)(result)
      } yield adaptedResult
    }

  /* to provide v5, remove legacy routes */

  def assertValidNewNameV5(organizationName: String, datasetName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        organization <- organizationDAO.findOne(organizationName) // the old organizationName is now the organization id
        _ <- bool2Fox(organization._id == request.identity._organization) ~> FORBIDDEN
        _ <- datasetService.assertValidDatasetName(datasetName)
      } yield Ok
    }

  /* private helper methods for legacy adaptation */

  private def addDataSetToTaskInAnnotation(jsResult: JsObject): Fox[JsObject] = {
    val taskObjectOpt = (jsResult \ "task").asOpt[JsObject]
    taskObjectOpt
      .map(task =>
        for {
          adaptedTask <- addLegacyDataSetFieldToTask(task)
          adaptedJsResult <- tryo(jsResult - "task" + ("task" -> adaptedTask)).toFox
        } yield adaptedJsResult)
      .getOrElse(Fox.successful(jsResult))
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

  private def replaceAnnotationLayers(jsObject: JsObject) = {
    val annotationLayers = (jsObject \ "annotationLayers").as[List[AnnotationLayer]]
    val skeletonTracingId = annotationLayers.find(_.typ == AnnotationLayerType.Skeleton).map(_.tracingId)
    val volumeTracingId = annotationLayers.find(_.typ == AnnotationLayerType.Volume).map(_.tracingId)
    val newJson = jsObject + ("tracing" -> Json.obj("skeleton" -> Json.toJson(skeletonTracingId),
                                                    "volume" -> Json.toJson(volumeTracingId)))
    for {
      _ <- bool2Fox(annotationLayers.count(_.typ == AnnotationLayerType.Skeleton) <= 1) ?~> "A requested annotation has more than one skeleton layer and cannot be served using the legacy api, please use api version v5 or newer"
      _ <- bool2Fox(annotationLayers.count(_.typ == AnnotationLayerType.Volume) <= 1) ?~> "A requested annotation has more than one volume layer and cannot be served using the legacy api, please use api version v5 or newer"
    } yield newJson - "annotationLayers"
  }

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
