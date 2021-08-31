package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.tools.Fox
import javax.inject.Inject
import models.project.ProjectDAO
import models.task.{TaskDAO, TaskService}
import oxalis.security.WkEnv
import play.api.http.HttpEntity
import play.api.libs.json.{JsArray, JsObject, JsValue, Json}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers, Result}
import utils.ObjectId

import scala.concurrent.ExecutionContext

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

  /* to provide v2, insert automatic timestamp in finish and info request */

  def annotationFinishV2(typ: String, id: String): Action[AnyContent] =
    annotationController.finish(typ, id, System.currentTimeMillis)

  def annotationInfoV2(typ: String, id: String): Action[AnyContent] =
    annotationController.info(typ, id, System.currentTimeMillis)

  /* to provide v1, replace new field “visibility” in annotation json by old boolean field “isPublic” */

  def annotationDuplicate(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      result <- annotationController.duplicate(typ, id)(request)
    } yield replaceVisibilityInResultJson(result)
  }

  def annotationFinish(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      result <- annotationController.finish(typ, id, System.currentTimeMillis)(request)
    } yield replaceVisibilityInResultJson(result)
  }

  def annotationReopen(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      result <- annotationController.reopen(typ, id)(request)
    } yield replaceVisibilityInResultJson(result)
  }

  def annotationReset(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      result <- annotationController.reset(typ, id)(request)
    } yield replaceVisibilityInResultJson(result)
  }

  def annotationTransfer(typ: String, id: String): Action[JsValue] = sil.SecuredAction.async(parse.json) {
    implicit request =>
      for {
        result <- annotationController.transfer(typ, id)(request)
      } yield replaceVisibilityInResultJson(result)
  }

  def annotationInfo(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      result <- annotationController.info(typ, id, System.currentTimeMillis)(request)
    } yield replaceVisibilityInResultJson(result)
  }

  def annotationMakeHybrid(typ: String, id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      result <- annotationController.makeHybrid(typ, id, None)(request)
    } yield replaceVisibilityInResultJson(result)
  }

  def annotationMerge(typ: String, id: String, mergedTyp: String, mergedId: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        result <- annotationController.merge(typ, id, mergedTyp, mergedId)(request)
      } yield replaceVisibilityInResultJson(result)
    }

  def annotationCreateExplorational(organizationName: String,
                                    dataSetName: String): Action[CreateExplorationalParameters] =
    sil.SecuredAction.async(validateJson[CreateExplorationalParameters]) { implicit request =>
      for {
        result <- annotationController.createExplorational(organizationName, dataSetName)(request)
      } yield replaceVisibilityInResultJson(result)
    }

  def annotations(isFinished: Option[Boolean],
                  limit: Option[Int],
                  pageNumber: Option[Int],
                  includeTotalCount: Option[Boolean]): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        result <- userController.annotations(isFinished, limit, pageNumber, includeTotalCount)(request)
      } yield replaceVisibilityInResultJson(result)
  }

  def userAnnotations(id: String,
                      isFinished: Option[Boolean],
                      limit: Option[Int],
                      pageNumber: Option[Int],
                      includeTotalCount: Option[Boolean]): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        result <- userController.userAnnotations(id, isFinished, limit, pageNumber, includeTotalCount)(request)
      } yield replaceVisibilityInResultJson(result)
  }

  def taskRequest: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      result <- taskController.request()(request)
    } yield replaceVisibilityInResultJson(result)
  }

  def annotationsForTask(id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      result <- annotationController.annotationsForTask(id)(request)
    } yield replaceVisibilityInResultJson(result)
  }

  def tasks(isFinished: Option[Boolean],
            limit: Option[Int],
            pageNumber: Option[Int],
            includeTotalCount: Option[Boolean]): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      result <- userController.tasks(isFinished, limit, pageNumber, includeTotalCount)(request)
    } yield replaceVisibilityInResultJson(result)
  }

  def userTasks(id: String,
                isFinished: Option[Boolean],
                limit: Option[Int],
                pageNumber: Option[Int],
                includeTotalCount: Option[Boolean]): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      result <- userController.userTasks(id, isFinished, limit, pageNumber, includeTotalCount)(request)
    } yield replaceVisibilityInResultJson(result)
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

  private def replaceVisibilityInResultJson(result: Result): Result = {
    def replaceVisibilityInJsObject(jsObject: JsObject) = {
      val visibilityString = (jsObject \ "visibility").as[String]
      val newJson = jsObject + ("isPublic" -> Json.toJson(visibilityString == "Public"))
      newJson - "visibility"
    }

    if (result.header.status == 200) {
      val bodyJsonValue = result.body match {
        case HttpEntity.Strict(data, _) => Json.parse(data.decodeString("utf-8"))
        case _                          => return BadRequest
      }

      val newJson = bodyJsonValue match {
        case JsArray(value)  => Json.toJson(value.map(el => replaceVisibilityInJsObject(el.as[JsObject])))
        case jsObj: JsObject => Json.toJson(replaceVisibilityInJsObject(jsObj))
        case _               => return BadRequest
      }

      Ok(Json.toJson(newJson)).copy(header = result.header)
    } else result
  }
}
