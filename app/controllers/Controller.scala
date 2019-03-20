package controllers

import com.mohiva.play.silhouette.api.actions.{SecuredRequest, UserAwareRequest}
import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, DBAccessContext}
import com.scalableminds.webknossos.datastore.controllers.ValidationHelpers
import com.scalableminds.util.mvc.ExtendedController
import com.scalableminds.util.tools.{Converter, Fox}
import com.typesafe.scalalogging.LazyLogging
import models.user.User
import net.liftweb.common.{Box, Failure, Full, ParamFailure}
import oxalis.security.{UserAwareRequestLogging, WkEnv}
import play.api.i18n.{I18nSupport, Messages, MessagesProvider}
import play.api.libs.json._
import play.api.mvc.{InjectedController, Request, Result}

import scala.concurrent.ExecutionContext

trait Controller
    extends InjectedController
    with ExtendedController
    with ValidationHelpers
    with UserAwareRequestLogging
    with I18nSupport
    with LazyLogging {

  def jsonErrorWrites(errors: JsError)(implicit m: MessagesProvider): JsObject =
    Json.obj(
      "errors" -> errors.errors.map(error =>
        error._2.foldLeft(Json.obj("field" -> error._1.toJsonString)) {
          case (js, e) => js ++ Json.obj("error" -> Messages(e.message))
      })
    )

  def bulk2StatusJson(results: List[Box[JsObject]]) =
    results.map {
      case Full(s) =>
        Json.obj("status" -> OK, jsonSuccess -> s)
      case ParamFailure(msg, _, _, errorCode: Int) =>
        Json.obj("status" -> errorCode, jsonError -> msg)
      case Failure(msg, _, _) =>
        Json.obj("status" -> BAD_REQUEST, jsonError -> msg)
    }

  def withJsonBodyAs[A](f: A => Fox[Result])(implicit rds: Reads[A],
                                             request: Request[JsValue],
                                             m: MessagesProvider,
                                             ec: ExecutionContext): Fox[Result] =
    withJsonBodyUsing(rds)(f)

  def withJsonBodyUsing[A](reads: Reads[A])(
      f: A => Fox[Result])(implicit request: Request[JsValue], m: MessagesProvider, ec: ExecutionContext): Fox[Result] =
    withJsonUsing(request.body, reads)(f)

  def withJsonAs[A](json: JsReadable)(
      f: A => Fox[Result])(implicit rds: Reads[A], m: MessagesProvider, ec: ExecutionContext): Fox[Result] =
    withJsonUsing(json, rds)(f)

  def withJsonUsing[A](json: JsReadable, reads: Reads[A])(f: A => Fox[Result])(implicit m: MessagesProvider,
                                                                               ec: ExecutionContext): Fox[Result] =
    json.validate(reads) match {
      case JsSuccess(result, _) =>
        f(result)
      case e: JsError =>
        Fox.successful(JsonBadRequest(jsonErrorWrites(e), Messages("format.json.invalid")))
    }

  implicit def userToDBAccess(user: User): DBAccessContext =
    AuthorizedAccessContext(user)

  implicit def userAwareRequestToDBAccess(implicit request: UserAwareRequest[WkEnv, _]) =
    DBAccessContext(request.identity)

  implicit def securedRequestToDBAccess(implicit request: SecuredRequest[WkEnv, _]) =
    DBAccessContext(Some(request.identity))
}
