package models.task

import com.scalableminds.util.mvc.JsonResultAttribues
import com.scalableminds.util.tools.Fox
import net.liftweb.common.{Box, Failure, Full, ParamFailure}
import play.api.http.Status
import play.api.libs.json._

import scala.concurrent.{ExecutionContext, Future}

case class TaskCreationResult(tasks: List[JsObject], warnings: List[String])

object TaskCreationResult extends JsonResultAttribues with Status {
  implicit val jsonFormat: OFormat[TaskCreationResult] = Format[TaskCreationResult]

  def fromTaskJsFoxes(taskJsons: List[Fox[JsObject]], warnings: List[String])(
      implicit ec: ExecutionContext): Future[TaskCreationResult] = {
    val taskJsonFuture: Future[List[Box[JsObject]]] = Fox.sequence(taskJsons)
    taskJsonFuture.map { taskJsonBoxes =>
      TaskCreationResult.fromBoxResults(taskJsonBoxes, warnings)
    }
  }

  def fromBoxResults(results: List[Box[JsObject]], warnings: List[String]): TaskCreationResult = {
    val tasks = results.map {
      case Full(s) =>
        Json.obj("status" -> OK, jsonSuccess -> s)
      case ParamFailure(msg, _, _, errorCode: Int) =>
        Json.obj("status" -> errorCode, jsonError -> msg)
      case Failure(msg, _, _) =>
        Json.obj("status" -> BAD_REQUEST, jsonError -> msg)
    }
    TaskCreationResult(tasks, warnings)
  }
}
