package controllers

import play.silhouette.api.Silhouette
import play.silhouette.api.actions.{SecuredRequest, UserAwareRequest}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.annotation.{AnnotationLayer, AnnotationLayerType}
import com.scalableminds.webknossos.tracingstore.tracings.volume.ResolutionRestrictions
import models.dataset.DatasetService
import models.organization.OrganizationDAO

import javax.inject.Inject
import models.project.ProjectDAO
import models.task.{TaskDAO, TaskService}
import models.user.User
import play.api.http.HttpEntity
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent, PlayBodyParsers, Result}
import security.WkEnv
import utils.ObjectId

import scala.concurrent.ExecutionContext

case class LegacyCreateExplorationalParameters(typ: String,
                                               fallbackLayerName: Option[String],
                                               resolutionRestrictions: Option[ResolutionRestrictions])
object LegacyCreateExplorationalParameters {
  implicit val jsonFormat: OFormat[LegacyCreateExplorationalParameters] =
    Json.format[LegacyCreateExplorationalParameters]
}

class LegacyApiController @Inject()(annotationController: AnnotationController,
                                    userController: UserController,
                                    projectController: ProjectController,
                                    projectDAO: ProjectDAO,
                                    organizationDAO: OrganizationDAO,
                                    datasetService: DatasetService,
                                    taskDAO: TaskDAO,
                                    taskService: TaskService,
                                    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller {

  def assertValidNewNameV5(organizationName: String, datasetName: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        organization <- organizationDAO.findOne(organizationName) // the old organizationName is now the organization id
        _ <- bool2Fox(organization._id == request.identity._organization) ~> FORBIDDEN
        _ <- datasetService.assertValidDatasetName(datasetName)
        _ <- datasetService.assertNewDatasetName(datasetName, organization._id) ?~> "dataset.name.alreadyTaken"
      } yield Ok
    }

  /* to provide v4
   - replace new annotation layers by old tracing ids (changed in v5)
   */

  def annotationEditV4(typ: String, id: String): Action[JsValue] = sil.SecuredAction.async(parse.json) {
    implicit request =>
      for {
        _ <- Fox.successful(logVersioned(request))
        result <- annotationController.editAnnotation(typ, id)(request)
        adaptedResult <- replaceInResult(replaceAnnotationLayers)(result)
      } yield adaptedResult
  }

  def annotationDuplicateV4(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- Fox.successful(logVersioned(request))
      result <- annotationController.duplicate(typ, id)(request)
      adaptedResult <- replaceInResult(replaceAnnotationLayers)(result)
    } yield adaptedResult
  }

  def annotationInfoV4(typ: String, id: String, timestamp: Long): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        _ <- Fox.successful(logVersioned(request))
        result <- annotationController.info(typ, id, timestamp)(request)
        adaptedResult <- replaceInResult(replaceAnnotationLayers)(result)
      } yield adaptedResult
  }

  def annotationMergeV4(typ: String, id: String, mergedTyp: String, mergedId: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- Fox.successful(logVersioned(request))
        result <- annotationController.merge(typ, id, mergedTyp, mergedId)(request)
        adaptedResult <- replaceInResult(replaceAnnotationLayers)(result)
      } yield adaptedResult
    }

  def annotationFinishV4(typ: String, id: String, timestamp: Long): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        _ <- Fox.successful(logVersioned(request))
        result <- annotationController.finish(typ, id, timestamp)(request)
        adaptedResult <- replaceInResult(replaceAnnotationLayers)(result)
      } yield adaptedResult
  }

  def annotationReopenV4(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- Fox.successful(logVersioned(request))
      result <- annotationController.reopen(typ, id)(request)
      adaptedResult <- replaceInResult(replaceAnnotationLayers)(result)
    } yield adaptedResult
  }

  def annotationResetV4(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- Fox.successful(logVersioned(request))
      result <- annotationController.reset(typ, id)(request)
      adaptedResult <- replaceInResult(replaceAnnotationLayers)(result)
    } yield adaptedResult
  }

  def annotationListForCurrentUserV4(isFinished: Option[Boolean],
                                     limit: Option[Int],
                                     pageNumber: Option[Int],
                                     includeTotalCount: Option[Boolean]): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        _ <- Fox.successful(logVersioned(request))
        result <- userController.annotations(isFinished, limit, pageNumber, includeTotalCount)(request)
        adaptedResult <- replaceInResult(replaceAnnotationLayers)(result)
      } yield adaptedResult
  }

  def annotationTasksV4(isFinished: Option[Boolean],
                        limit: Option[Int],
                        pageNumber: Option[Int],
                        includeTotalCount: Option[Boolean]): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        _ <- Fox.successful(logVersioned(request))
        result <- userController.tasks(isFinished, limit, pageNumber, includeTotalCount)(request)
        adaptedResult <- replaceInResult(replaceAnnotationLayers)(result)
      } yield adaptedResult
  }

  def annotationListByUserV4(id: String,
                             isFinished: Option[Boolean],
                             limit: Option[Int],
                             pageNumber: Option[Int],
                             includeTotalCount: Option[Boolean]): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        _ <- Fox.successful(logVersioned(request))
        result <- userController.userAnnotations(id, isFinished, limit, pageNumber, includeTotalCount)(request)
        adaptedResult <- replaceInResult(replaceAnnotationLayers)(result)
      } yield adaptedResult
  }

  def annotationTasksByUserV4(id: String,
                              isFinished: Option[Boolean],
                              limit: Option[Int],
                              pageNumber: Option[Int],
                              includeTotalCount: Option[Boolean]): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        _ <- Fox.successful(logVersioned(request))
        result <- userController.userTasks(id, isFinished, limit, pageNumber, includeTotalCount)(request)
        adaptedResult <- replaceInResult(replaceAnnotationLayers)(result)
      } yield adaptedResult
  }

  def annotationsForTaskV4(id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- Fox.successful(logVersioned(request))
      result <- annotationController.annotationsForTask(id)(request)
      adaptedResult <- replaceInResult(replaceAnnotationLayers)(result)
    } yield adaptedResult
  }

  def annotationCreateExplorationalV4(organizationName: String, // the old organizationName is now the organization id
                                      datasetName: String): Action[LegacyCreateExplorationalParameters] =
    sil.SecuredAction.async(validateJson[LegacyCreateExplorationalParameters]) { implicit request =>
      for {
        _ <- Fox.successful(logVersioned(request))
        result <- annotationController.createExplorational(organizationName, datasetName)(
          request.withBody(replaceCreateExplorationalParameters(request)))
        adaptedResult <- replaceInResult(replaceAnnotationLayers)(result)
      } yield adaptedResult
    }

  /* to provide v3, find projects by name */

  def projectRead(name: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- Fox.successful(logVersioned(request))
      project <- projectDAO.findOneByNameAndOrganization(name, request.identity._organization)
      result <- projectController.read(project._id.toString)(request)
    } yield result
  }

  def projectDelete(name: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- Fox.successful(logVersioned(request))
      project <- projectDAO.findOneByNameAndOrganization(name, request.identity._organization)
      result <- projectController.delete(project._id.toString)(request)
    } yield result
  }

  def projectUpdate(name: String): Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    for {
      _ <- Fox.successful(logVersioned(request))
      project <- projectDAO.findOneByNameAndOrganization(name, request.identity._organization)
      result <- projectController.update(project._id.toString)(request)
    } yield result
  }

  def projectTasksForProject(name: String,
                             limit: Option[Int] = None,
                             pageNumber: Option[Int] = None,
                             includeTotalCount: Option[Boolean]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- Fox.successful(logVersioned(request))
        project <- projectDAO.findOneByNameAndOrganization(name, request.identity._organization)
        result <- projectController.tasksForProject(project._id.toString, limit, pageNumber, includeTotalCount)(request)
      } yield result
    }

  def projectIncrementEachTasksInstances(name: String, delta: Option[Long]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- Fox.successful(logVersioned(request))
        project <- projectDAO.findOneByNameAndOrganization(name, request.identity._organization)
        result <- projectController.incrementEachTasksInstances(project._id.toString, delta)(request)
      } yield result
    }

  def projectPause(name: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- Fox.successful(logVersioned(request))
      project <- projectDAO.findOneByNameAndOrganization(name, request.identity._organization)
      result <- projectController.pause(project._id.toString)(request)
    } yield result
  }

  def projectResume(name: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- Fox.successful(logVersioned(request))
      project <- projectDAO.findOneByNameAndOrganization(name, request.identity._organization)
      result <- projectController.resume(project._id.toString)(request)
    } yield result
  }

  def taskListTasks: Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    for {
      _ <- Fox.successful(logVersioned(request))
      userIdOpt <- Fox.runOptional((request.body \ "user").asOpt[String])(ObjectId.fromString)
      projectNameOpt = (request.body \ "project").asOpt[String]
      projectOpt <- Fox.runOptional(projectNameOpt)(projectName =>
        projectDAO.findOneByNameAndOrganization(projectName, request.identity._organization))
      taskIdsOpt <- Fox.runOptional((request.body \ "ids").asOpt[List[String]])(ids =>
        Fox.serialCombined(ids)(ObjectId.fromString))
      taskTypeIdOpt <- Fox.runOptional((request.body \ "taskType").asOpt[String])(ObjectId.fromString)
      randomizeOpt = (request.body \ "random").asOpt[Boolean]
      tasks <- taskDAO.findAllByProjectAndTaskTypeAndIdsAndUser(projectOpt.map(_._id),
                                                                taskTypeIdOpt,
                                                                taskIdsOpt,
                                                                userIdOpt,
                                                                randomizeOpt)
      jsResult <- Fox.serialCombined(tasks)(taskService.publicWrites(_))
    } yield Ok(Json.toJson(jsResult))
  }

  /* to provide v2
   - insert automatic timestamp in finish and info request (changed in v3)
   - replace new annotation layers by old tracing ids (changed in v5)
   */

  def annotationFinishV2(typ: String, id: String): Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    for {
      _ <- Fox.successful(logVersioned(request))
      result <- annotationController.finish(typ, id, System.currentTimeMillis)(request)
      adaptedResult <- replaceInResult(replaceAnnotationLayers)(result)
    } yield adaptedResult
  }

  def annotationInfoV2(typ: String, id: String): Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    for {
      _ <- Fox.successful(logVersioned(request))
      result <- annotationController.info(typ, id, System.currentTimeMillis)(request)
      adaptedResult <- replaceInResult(replaceAnnotationLayers)(result)
    } yield adaptedResult
  }

  /* to provide v1,
    - replace new field “visibility” in annotation json by old boolean field “isPublic” (changed in v2)
    - insert automatic timestamp in finish and info request (changed in v3)
    - replace new annotation layers by old tracing ids (changed in v5)
   */

  def annotationDuplicateV1(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- Fox.successful(logVersioned(request))
      result <- annotationController.duplicate(typ, id)(request)
      adaptedResult <- replaceInResult(replaceVisibility, replaceAnnotationLayers)(result)
    } yield adaptedResult
  }

  def annotationFinishV1(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- Fox.successful(logVersioned(request))
      result <- annotationController.finish(typ, id, System.currentTimeMillis)(request)
      adaptedResult <- replaceInResult(replaceVisibility, replaceAnnotationLayers)(result)
    } yield adaptedResult
  }

  def annotationReopenV1(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- Fox.successful(logVersioned(request))
      result <- annotationController.reopen(typ, id)(request)
      adaptedResult <- replaceInResult(replaceVisibility, replaceAnnotationLayers)(result)
    } yield adaptedResult
  }

  def annotationResetV1(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- Fox.successful(logVersioned(request))
      result <- annotationController.reset(typ, id)(request)
      adaptedResult <- replaceInResult(replaceVisibility, replaceAnnotationLayers)(result)
    } yield adaptedResult
  }

  def annotationInfoV1(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- Fox.successful(logVersioned(request))
      result <- annotationController.info(typ, id, System.currentTimeMillis)(request)
      adaptedResult <- replaceInResult(replaceVisibility, replaceAnnotationLayers)(result)
    } yield adaptedResult
  }

  def annotationMakeHybridV1(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        _ <- Fox.successful(logVersioned(request))
        result <- annotationController.makeHybrid(typ, id, None)(request)
        adaptedResult <- replaceInResult(replaceVisibility, replaceAnnotationLayers)(result)
      } yield adaptedResult
  }

  def annotationMergeV1(typ: String, id: String, mergedTyp: String, mergedId: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- Fox.successful(logVersioned(request))
        result <- annotationController.merge(typ, id, mergedTyp, mergedId)(request)
        adaptedResult <- replaceInResult(replaceVisibility, replaceAnnotationLayers)(result)
      } yield adaptedResult
    }

  def annotationCreateExplorationalV1(organizationName: String, // the old organizationName is now the organization id
                                      datasetName: String): Action[LegacyCreateExplorationalParameters] =
    sil.SecuredAction.async(validateJson[LegacyCreateExplorationalParameters]) { implicit request =>
      for {
        _ <- Fox.successful(logVersioned(request))
        result <- annotationController.createExplorational(organizationName, datasetName)(
          request.withBody(replaceCreateExplorationalParameters(request)))
        adaptedResult <- replaceInResult(replaceVisibility, replaceAnnotationLayers)(result)
      } yield adaptedResult
    }

  def annotationListForCurrentUserV1(isFinished: Option[Boolean],
                                     limit: Option[Int],
                                     pageNumber: Option[Int],
                                     includeTotalCount: Option[Boolean]): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        _ <- Fox.successful(logVersioned(request))
        result <- userController.annotations(isFinished, limit, pageNumber, includeTotalCount)(request)
        adaptedResult <- replaceInResult(replaceVisibility, replaceAnnotationLayers)(result)
      } yield adaptedResult
  }

  def annotationListByUserV1(id: String,
                             isFinished: Option[Boolean],
                             limit: Option[Int],
                             pageNumber: Option[Int],
                             includeTotalCount: Option[Boolean]): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        _ <- Fox.successful(logVersioned(request))
        result <- userController.userAnnotations(id, isFinished, limit, pageNumber, includeTotalCount)(request)
        adaptedResult <- replaceInResult(replaceVisibility, replaceAnnotationLayers)(result)
      } yield adaptedResult
  }

  def annotationsForTaskV1(id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- Fox.successful(logVersioned(request))
      result <- annotationController.annotationsForTask(id)(request)
      adaptedResult <- replaceInResult(replaceVisibility, replaceAnnotationLayers)(result)
    } yield adaptedResult
  }

  def annotationTasksV1(isFinished: Option[Boolean],
                        limit: Option[Int],
                        pageNumber: Option[Int],
                        includeTotalCount: Option[Boolean]): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        _ <- Fox.successful(logVersioned(request))
        result <- userController.tasks(isFinished, limit, pageNumber, includeTotalCount)(request)
        adaptedResult <- replaceInResult(replaceVisibility, replaceAnnotationLayers)(result)
      } yield adaptedResult
  }

  def annotationTasksByUserV1(id: String,
                              isFinished: Option[Boolean],
                              limit: Option[Int],
                              pageNumber: Option[Int],
                              includeTotalCount: Option[Boolean]): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        _ <- Fox.successful(logVersioned(request))
        result <- userController.userTasks(id, isFinished, limit, pageNumber, includeTotalCount)(request)
        adaptedResult <- replaceInResult(replaceVisibility, replaceAnnotationLayers)(result)
      } yield adaptedResult
  }

  def annotationEditV1(typ: String, id: String): Action[JsValue] = sil.SecuredAction.async(parse.json) {
    implicit request =>
      logVersioned(request)
      val oldRequest = request
      val newRequest =
        if (request.body.as[JsObject].keys.contains("isPublic"))
          request.withBody(Json.toJson(insertVisibilityInJsObject(oldRequest.body.as[JsObject])))
        else request

      for {
        result <- annotationController.editAnnotation(typ, id)(newRequest)
        adaptedResult <- replaceInResult(replaceVisibility, replaceAnnotationLayers)(result)
      } yield adaptedResult
  }

  private def replaceCreateExplorationalParameters(
      request: SecuredRequest[WkEnv, LegacyCreateExplorationalParameters]) = {
    val skeletonParameters =
      if (request.body.typ == "volume") None
      else
        Some(
          AnnotationLayerParameters(
            AnnotationLayerType.Skeleton,
            request.body.fallbackLayerName,
            autoFallbackLayer = false,
            None,
            request.body.resolutionRestrictions,
            name = Some(AnnotationLayer.defaultSkeletonLayerName),
            None
          ))
    val volumeParameters =
      if (request.body.typ == "skeleton") None
      else
        Some(
          AnnotationLayerParameters(
            AnnotationLayerType.Volume,
            request.body.fallbackLayerName,
            autoFallbackLayer = false,
            None,
            request.body.resolutionRestrictions,
            name = Some(AnnotationLayer.defaultVolumeLayerName),
            None
          ))
    List(skeletonParameters, volumeParameters).flatten
  }

  private def insertVisibilityInJsObject(jsObject: JsObject) = {
    val isPublic = (jsObject \ "isPublic").as[Boolean]
    val newJson = jsObject + ("visibility" -> Json.toJson(if (isPublic) "Public" else "Internal"))
    newJson - "isPublic"
  }

  private def replaceVisibility(jsObject: JsObject) = {
    val visibilityString = (jsObject \ "visibility").as[String]
    val newJson = jsObject + ("isPublic" -> Json.toJson(visibilityString == "Public"))
    Fox.successful(newJson - "visibility")
  }

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

  private def replaceInResult(replacement1: JsObject => Fox[JsObject], replacement2: JsObject => Fox[JsObject])(
      result: Result): Fox[Result] =
    replaceInResult(Fox.chainFunctions(List(replacement1, replacement2)))(result)

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

  private def logVersioned(request: UserAwareRequest[WkEnv, _]): Unit =
    request.identity.foreach(user => logVersioned(user, request.uri))

  private def logVersioned(user: User, uri: String): Unit =
    logger.info(s"Noted usage of legacy route $uri by user ${user._id}")

}
