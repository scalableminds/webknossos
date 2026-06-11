package controllers

import com.scalableminds.util.Msg
import play.silhouette.api.actions.{SecuredRequest, UserAwareRequest}
import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, DBAccessContext}
import com.scalableminds.util.mvc.ExtendedController
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import models.user.User
import play.api.libs.json._
import play.api.mvc.{InjectedController, Request, Result}
import security.{UserAwareRequestLogging, WkEnv}

import scala.concurrent.ExecutionContext

trait Controller extends InjectedController with ExtendedController with UserAwareRequestLogging with LazyLogging {

  private def jsonErrorWrites(errors: JsError): JsObject =
    Json.obj(
      "errors" -> errors.errors.map(error =>
        error._2.foldLeft(Json.obj("field" -> error._1.toJsonString)) {
          case (js, e) => js ++ Json.obj("error" -> e.message)
      })
    )

  def withJsonBodyAs[A](
      f: A => Fox[Result])(implicit rds: Reads[A], request: Request[JsValue], ec: ExecutionContext): Fox[Result] =
    withJsonBodyUsing(rds)(f)

  def withJsonBodyUsing[A](reads: Reads[A])(f: A => Fox[Result])(implicit request: Request[JsValue],
                                                                 ec: ExecutionContext): Fox[Result] =
    withJsonUsing(request.body, reads)(f)

  def withJsonAs[A](json: JsReadable)(f: A => Fox[Result])(implicit rds: Reads[A], ec: ExecutionContext): Fox[Result] =
    withJsonUsing(json, rds)(f)

  private def withJsonUsing[A](json: JsReadable, reads: Reads[A])(f: A => Fox[Result])(
      implicit ec: ExecutionContext): Fox[Result] =
    json.validate(using reads) match {
      case JsSuccess(result, _) =>
        f(result)
      case e: JsError =>
        Fox.successful(JsonBadRequest(jsonErrorWrites(e), Msg.invalidJson))
    }

  implicit def userToDBAccess(user: User): DBAccessContext =
    AuthorizedAccessContext(user)

  implicit def userAwareRequestToDBAccess(implicit request: UserAwareRequest[WkEnv, ?]): DBAccessContext =
    DBAccessContext(request.identity)

  implicit def securedRequestToDBAccess(implicit request: SecuredRequest[WkEnv, ?]): DBAccessContext =
    DBAccessContext(Some(request.identity))
}
