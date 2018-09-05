package controllers

import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, DBAccessContext}
import com.scalableminds.webknossos.datastore.controllers.ValidationHelpers
import com.scalableminds.util.mvc.ExtendedController
import com.scalableminds.util.tools.{Converter, Fox}
import com.typesafe.scalalogging.LazyLogging
import models.user.User
import net.liftweb.common.{Box, Failure, Full, ParamFailure}
import play.api.i18n.{I18nSupport, Messages}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import play.api.mvc.{Request, Result, Controller => PlayController}


trait Controller extends PlayController
  with ExtendedController
  with ValidationHelpers
  with I18nSupport
  with LazyLogging {

  def jsonErrorWrites(errors: JsError): JsObject =
    Json.obj(
      "errors" -> errors.errors.map(error =>
        error._2.foldLeft(Json.obj("field" -> error._1.toJsonString)) {
          case (js, e) => js ++ Json.obj("error" -> Messages(e.message))
        }
      )
    )

  def bulk2StatusJson(results: List[Box[JsObject]])= {
    results.map {
      case Full(s)                                 =>
        Json.obj("status" -> OK, jsonSuccess -> s)
      case ParamFailure(msg, _, _, errorCode: Int) =>
        Json.obj("status" -> errorCode, jsonError -> msg)
      case Failure(msg, _, _)                      =>
        Json.obj("status" -> BAD_REQUEST, jsonError -> msg)
    }
  }

  def withJsonBodyAs[A](f: A => Fox[Result])(implicit rds: Reads[A], request: Request[JsValue]): Fox[Result] = {
    withJsonBodyUsing(rds)(f)
  }

  def withJsonBodyUsing[A](reads: Reads[A])(f: A => Fox[Result])(implicit request: Request[JsValue]): Fox[Result] = {
    withJsonUsing(request.body, reads)(f)
  }

  def withJsonAs[A](json: JsReadable)(f: A => Fox[Result])(implicit rds: Reads[A]): Fox[Result] = {
    withJsonUsing(json, rds)(f)
  }

  def withJsonUsing[A](json: JsReadable, reads: Reads[A])(f: A => Fox[Result]): Fox[Result] = {
    json.validate(reads) match {
      case JsSuccess(result, _) =>
        f(result)
      case e: JsError           =>
        Fox.successful(JsonBadRequest(jsonErrorWrites(e), Messages("format.json.invalid")))
    }
  }

  implicit def userToDBAccess(user: User): DBAccessContext = {
    AuthorizedAccessContext(user)
  }
}
