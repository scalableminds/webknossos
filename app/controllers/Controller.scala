package controllers

import play.api.mvc.{Controller => PlayController, Request}
import oxalis.security.AuthenticatedRequest
import oxalis.view.ProvidesSessionData
import com.scalableminds.util.mvc.ExtendedController
import models.user.User
import net.liftweb.common.{Failure, Full}
import play.api.i18n.{MessagesApi, I18nSupport, Messages}
import models.binary.DataSet
import com.scalableminds.util.tools.Converter
import play.api.libs.json._

trait Controller extends PlayController
with ExtendedController
with ProvidesSessionData
with models.basics.Implicits
with I18nSupport
{
  def messagesApi: MessagesApi

  implicit def AuthenticatedRequest2Request[T](r: AuthenticatedRequest[T]) =
    r.request

  def ensureTeamAdministration(user: User, team: String) = {
    user.adminTeams.exists(_.team == team) match {
      case true => Full(true)
      case false => Failure(Messages("team.admin.notAllowed", team))
    }
  }

  def allowedToAdministrate(admin: User, user: User) =
    user.isEditableBy(admin) match {
      case true => Full(true)
      case false => Failure(Messages("notAllowed"))
    }


  def allowedToAdministrate(admin: User, dataSet: DataSet) =
    dataSet.isEditableBy(Some(admin)) match {
      case true => Full(true)
      case false => Failure(Messages("notAllowed"))
    }

  case class Filter[A, T](name: String, predicate: (A, T) => Boolean)(implicit converter: Converter[String, A]) {
    def applyOn(list: List[T])(implicit request: Request[_]): List[T] = {
      request.getQueryString(name).flatMap(converter.convert) match {
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
      "messages" -> errors.errors.map(error =>
        error._2.foldLeft(Json.obj("field" -> error._1.toJsonString)) {
          case (js, e) => js ++ Json.obj("error" -> Messages(e.message))
        }
      )
    )
}
