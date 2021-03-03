package controllers

import com.mohiva.play.silhouette.api.Silhouette
import javax.inject.Inject
import oxalis.security.WkEnv
import play.api.http.HttpEntity
import play.api.libs.json.{JsArray, JsObject, JsValue, Json}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers, Result}
import utils.WkConf

import scala.concurrent.ExecutionContext

class LegacyApiController @Inject()(annotationController: AnnotationController,
                                    taskController: TaskController,
                                    userController: UserController,
                                    conf: WkConf,
                                    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller {

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
      result <- annotationController.makeHybrid(typ, id)(request)
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
