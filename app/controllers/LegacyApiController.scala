package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.tracingstore.tracings.volume.ResolutionRestrictions
import javax.inject.Inject
import models.annotation.{AnnotationLayer, AnnotationLayerType}
import models.project.ProjectDAO
import models.task.{TaskDAO, TaskService}
import oxalis.security.WkEnv
import play.api.http.HttpEntity
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent, PlayBodyParsers, Result}
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
                                    taskController: TaskController,
                                    userController: UserController,
                                    projectController: ProjectController,
                                    projectDAO: ProjectDAO,
                                    taskDAO: TaskDAO,
                                    taskService: TaskService,
                                    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller {

  /* to provide v3, find projects by name */

  def projectRead(name: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      project <- projectDAO.findOneByNameAndOrganization(name, request.identity._organization)
      result <- projectController.read(project._id.toString)(request)
    } yield result
  }

  def projectDelete(name: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      project <- projectDAO.findOneByNameAndOrganization(name, request.identity._organization)
      result <- projectController.delete(project._id.toString)(request)
    } yield result
  }

  def projectUpdate(name: String): Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    for {
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
        project <- projectDAO.findOneByNameAndOrganization(name, request.identity._organization)
        result <- projectController.tasksForProject(project._id.toString, limit, pageNumber, includeTotalCount)(request)
      } yield result
    }

  def projectIncrementEachTasksInstances(name: String, delta: Option[Long]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        project <- projectDAO.findOneByNameAndOrganization(name, request.identity._organization)
        result <- projectController.incrementEachTasksInstances(project._id.toString, delta)(request)
      } yield result
    }

  def projectPause(name: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      project <- projectDAO.findOneByNameAndOrganization(name, request.identity._organization)
      result <- projectController.pause(project._id.toString)(request)
    } yield result
  }

  def projectResume(name: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      project <- projectDAO.findOneByNameAndOrganization(name, request.identity._organization)
      result <- projectController.resume(project._id.toString)(request)
    } yield result
  }

  def taskListTasks: Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    for {
      userIdOpt <- Fox.runOptional((request.body \ "user").asOpt[String])(ObjectId.parse)
      projectNameOpt = (request.body \ "project").asOpt[String]
      projectOpt <- Fox.runOptional(projectNameOpt)(projectName =>
        projectDAO.findOneByNameAndOrganization(projectName, request.identity._organization))
      taskIdsOpt <- Fox.runOptional((request.body \ "ids").asOpt[List[String]])(ids =>
        Fox.serialCombined(ids)(ObjectId.parse))
      taskTypeIdOpt <- Fox.runOptional((request.body \ "taskType").asOpt[String])(ObjectId.parse)
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
   */

  def annotationFinishV2(typ: String, id: String): Action[AnyContent] =
    annotationController.finish(typ, id, System.currentTimeMillis)

  def annotationInfoV2(typ: String, id: String): Action[AnyContent] =
    annotationController.info(typ, id, System.currentTimeMillis)

  /* to provide v1,
    - replace new field “visibility” in annotation json by old boolean field “isPublic” (changed in v2)
    - insert automatic timestamp in finish and info request (changed in v3)
   */

  def annotationDuplicate(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      result <- annotationController.duplicate(typ, id)(request)
      adaptedResult <- replaceInResult(replaceVisibility)(result)
    } yield adaptedResult
  }

  def annotationFinish(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      result <- annotationController.finish(typ, id, System.currentTimeMillis)(request)
      adaptedResult <- replaceInResult(replaceVisibility)(result)
    } yield adaptedResult
  }

  def annotationReopen(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      result <- annotationController.reopen(typ, id)(request)
      adaptedResult <- replaceInResult(replaceVisibility)(result)
    } yield adaptedResult
  }

  def annotationReset(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      result <- annotationController.reset(typ, id)(request)
      adaptedResult <- replaceInResult(replaceVisibility)(result)
    } yield adaptedResult
  }

  def annotationTransfer(typ: String, id: String): Action[JsValue] = sil.SecuredAction.async(parse.json) {
    implicit request =>
      for {
        result <- annotationController.transfer(typ, id)(request)
        adaptedResult <- replaceInResult(replaceVisibility)(result)
      } yield adaptedResult
  }

  def annotationInfoV4(typ: String, id: String, timestamp: Long): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        result <- annotationController.info(typ, id, timestamp)(request)
        adaptedResult <- replaceInResult(replaceAnnotationLayers)(result)
      } yield adaptedResult
  }

  def annotationInfoV1(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      result <- annotationController.info(typ, id, System.currentTimeMillis)(request)
      adaptedResult <- replaceInResult(replaceVisibility, replaceAnnotationLayers)(result)
    } yield adaptedResult
  }

  def annotationMakeHybridV1(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      result <- annotationController.makeHybrid(typ, id, None)(request)
      adaptedResult <- replaceInResult(replaceVisibility, replaceAnnotationLayers)(result)
    } yield adaptedResult
  }

  def annotationMergeV4(typ: String, id: String, mergedTyp: String, mergedId: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        result <- annotationController.merge(typ, id, mergedTyp, mergedId)(request)
        adaptedResult <- replaceInResult(replaceAnnotationLayers)(result)
      } yield adaptedResult
    }

  def annotationMergeV1(typ: String, id: String, mergedTyp: String, mergedId: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        result <- annotationController.merge(typ, id, mergedTyp, mergedId)(request)
        adaptedResult <- replaceInResult(replaceVisibility, replaceAnnotationLayers)(result)
      } yield adaptedResult
    }

  def annotationCreateExplorational(organizationName: String,
                                    dataSetName: String): Action[LegacyCreateExplorationalParameters] =
    sil.SecuredAction.async(validateJson[LegacyCreateExplorationalParameters]) { implicit request =>
      val skeletonParameters =
        if (request.body.typ == "volume") None
        else
          Some(
            CreateExplorationalParameters(AnnotationLayerType.Skeleton,
                                          request.body.fallbackLayerName,
                                          request.body.resolutionRestrictions,
                                          name = None))
      val volumeParameters =
        if (request.body.typ == "skeleton") None
        else
          Some(
            CreateExplorationalParameters(AnnotationLayerType.Volume,
                                          request.body.fallbackLayerName,
                                          request.body.resolutionRestrictions,
                                          name = None))
      val adaptedParameters: List[CreateExplorationalParameters] = List(skeletonParameters, volumeParameters).flatten
      for {
        result <- annotationController.createExplorational(organizationName, dataSetName)(
          request.withBody(adaptedParameters))
        adaptedResult <- replaceInResult(replaceVisibility)(result)
      } yield adaptedResult
    }

  def annotations(isFinished: Option[Boolean],
                  limit: Option[Int],
                  pageNumber: Option[Int],
                  includeTotalCount: Option[Boolean]): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        result <- userController.annotations(isFinished, limit, pageNumber, includeTotalCount)(request)
        adaptedResult <- replaceInResult(replaceVisibility)(result)
      } yield adaptedResult
  }

  def userAnnotations(id: String,
                      isFinished: Option[Boolean],
                      limit: Option[Int],
                      pageNumber: Option[Int],
                      includeTotalCount: Option[Boolean]): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        result <- userController.userAnnotations(id, isFinished, limit, pageNumber, includeTotalCount)(request)
        adaptedResult <- replaceInResult(replaceVisibility)(result)
      } yield adaptedResult
  }

  def taskRequest: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      result <- taskController.request()(request)
      adaptedResult <- replaceInResult(replaceVisibility)(result)
    } yield adaptedResult
  }

  def annotationsForTask(id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      result <- annotationController.annotationsForTask(id)(request)
      adaptedResult <- replaceInResult(replaceVisibility)(result)
    } yield adaptedResult
  }

  def tasks(isFinished: Option[Boolean],
            limit: Option[Int],
            pageNumber: Option[Int],
            includeTotalCount: Option[Boolean]): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      result <- userController.tasks(isFinished, limit, pageNumber, includeTotalCount)(request)
      adaptedResult <- replaceInResult(replaceVisibility)(result)
    } yield adaptedResult
  }

  def userTasks(id: String,
                isFinished: Option[Boolean],
                limit: Option[Int],
                pageNumber: Option[Int],
                includeTotalCount: Option[Boolean]): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      result <- userController.userTasks(id, isFinished, limit, pageNumber, includeTotalCount)(request)
      adaptedResult <- replaceInResult(replaceVisibility)(result)
    } yield adaptedResult
  }

  def editAnnotation(typ: String, id: String): Action[JsValue] = sil.SecuredAction.async(parse.json) {
    implicit request =>
      val oldRequest = request.request
      val newRequest =
        if (request.body.as[JsObject].keys.contains("isPublic"))
          request.copy(
            request = oldRequest.withBody(Json.toJson(insertVisibilityInJsObject(oldRequest.body.as[JsObject]))))
        else request

      annotationController.editAnnotation(typ, id)(newRequest)
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
      val bodyJsonValue = result.body match {
        case HttpEntity.Strict(data, _) => Json.parse(data.decodeString("utf-8"))
        case _                          => return Fox.successful(BadRequest)
      }

      val newJsonFox = bodyJsonValue match {
        case JsArray(value) =>
          for { valueList <- Fox.serialCombined(value.toList)(el => replacement(el.as[JsObject])) } yield
            Json.toJson(valueList)
        case jsObj: JsObject => replacement(jsObj)
        case _               => return Fox.successful(BadRequest)
      }

      for {
        newJson <- newJsonFox
      } yield Ok(Json.toJson(newJson)).copy(header = result.header)
    } else Fox.successful(result)

}
