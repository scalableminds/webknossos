package models.annotation

import models.user.User
import play.api.libs.functional.syntax._
import play.api.libs.json._
import scala.async.Async._
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import braingames.reactivemongo.GlobalAccessContext
import models.team.Role

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 02.06.13
 * Time: 02:02
 */

class AnnotationRestrictions {
  def allowAccess(user: Option[User]): Boolean = false

  def allowUpdate(user: Option[User]): Boolean = false

  def allowFinish(user: Option[User]): Boolean = false

  def allowDownload(user: Option[User]): Boolean = false

  def allowAccess(user: User): Boolean = allowAccess(Some(user))

  def allowUpdate(user: User): Boolean = allowUpdate(Some(user))

  def allowFinish(user: User): Boolean = allowFinish(Some(user))

  def allowDownload(user: User): Boolean = allowDownload(Some(user))

}

object AnnotationRestrictions {
  def writeAsJson(ar: AnnotationRestrictions, u: Option[User]) : JsObject =
    Json.obj(
      "allowAccess" -> ar.allowAccess(u),
      "allowUpdate" -> ar.allowUpdate(u),
      "allowFinish" -> ar.allowFinish(u),
      "allowDownload" -> ar.allowDownload(u))

  def restrictEverything =
    new AnnotationRestrictions()

  def defaultAnnotationRestrictions(annotation: AnnotationLike) =
    new AnnotationRestrictions {
      override def allowAccess(user: Option[User]) = {
        user.map {
          user =>
            annotation._user == user._id || user.roleInTeam(annotation.team) == Some(Role.Admin)
        } getOrElse false
      }

      override def allowUpdate(user: Option[User]) = {
        user.map {
          user =>
            annotation._user == user._id && !annotation.state.isFinished
        } getOrElse false
      }

      override def allowFinish(user: Option[User]) = {
        user.map {
          user =>
            (annotation._user == user._id || user.roleInTeam(annotation.team) == Some(Role.Admin)) && !annotation.state.isFinished
        } getOrElse false
      }

      override def allowDownload(user: Option[User]) = {
        user.map {
          user =>
            !annotation.isTrainingsAnnotation && allowAccess(user)
        } getOrElse false
      }
    }
}
