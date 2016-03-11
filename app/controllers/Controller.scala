package controllers

import scala.concurrent.Future

import play.api.mvc.{Controller => PlayController, Result, Request}
import oxalis.security.AuthenticatedRequest
import oxalis.view.ProvidesSessionData
import com.scalableminds.util.mvc.ExtendedController
import models.user.User
import net.liftweb.common.{ParamFailure, Box, Failure, Full}
import play.api.i18n.{MessagesApi, I18nSupport, Messages}
import models.binary.DataSet
import com.scalableminds.util.tools.{Fox, Converter}
import play.api.libs.json._
import scala.concurrent.ExecutionContext.Implicits.global

trait Controller extends PlayController
with ExtendedController
with ProvidesSessionData
with models.basics.Implicits
with I18nSupport
{
  def messagesApi: MessagesApi

  implicit def AuthenticatedRequest2Request[T](r: AuthenticatedRequest[T]): Request[T] =
    r.request

  def ensureTeamAdministration(user: User, team: String) =
    user.adminTeams.exists(_.team == team) ?~> Messages("team.admin.notAllowed", team)

  def allowedToAdministrate(admin: User, dataSet: DataSet) =
    dataSet.isEditableBy(Some(admin)) ?~> Messages("notAllowed")

  case class Filter[A, T](name: String, predicate: (A, T) => Boolean, default: Option[String] = None)(implicit converter: Converter[String, A]) {
    def applyOn(list: List[T])(implicit request: Request[_]): List[T] = {
      request.getQueryString(name).orElse(default).flatMap(converter.convert) match {
        case Some(attr) => list.filter(predicate(attr, _))
        case _ => list
      }
    }
  }

  case class FilterColl[T](filters: Seq[Filter[_, T]]) {
    def applyOn(list: List[T])(implicit request: Request[_]): List[T] = {
      filters.foldLeft(list) {
        case (l, filter) => filter.applyOn(l)
      }
    }
  }

  def UsingFilters[T, R](filters: Filter[_, T]*)(block: FilterColl[T] => R): R = {
    block(FilterColl(filters))
  }

  def jsonErrorWrites(errors: JsError): JsObject =
    Json.obj(
      "errors" -> errors.errors.map(error =>
        error._2.foldLeft(Json.obj("field" -> error._1.toJsonString)) {
          case (js, e) => js ++ Json.obj("error" -> Messages(e.message))
        }
      )
    )

  def bulk2StatusJson(futureResults: List[Fox[String]]) = {
    def singleResult2Status(e: Box[String]) =
      e match {
        case Full(s)                                 =>
          Json.obj("status" -> OK, jsonSuccess -> s)
        case ParamFailure(msg, _, _, errorCode: Int) =>
          Json.obj("status" -> errorCode, jsonError -> msg)
        case Failure(msg, _, _)                      =>
          Json.obj("status" -> BAD_REQUEST, jsonError -> msg)
      }
    Fox.sequence(futureResults).map { results =>
      val successful = results.count(_.isDefined)
      val errors = results.exists(_.isEmpty)
      val items = results.map(singleResult2Status)
      Json.obj("errors" -> errors, "successful" -> successful, "items" -> items)
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
      case e: JsError =>
        Fox.successful(JsonBadRequest(jsonErrorWrites(e), Messages("format.json.invalid")))
    }
  }
}
