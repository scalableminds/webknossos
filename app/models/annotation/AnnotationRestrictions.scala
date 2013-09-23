package models.annotation

import models.user.User
import models.security.Role
import play.api.libs.functional.syntax._
import play.api.libs.json._

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
  def writeFor(u: Option[User]): Writes[AnnotationRestrictions] =
    ((__ \ 'allowAccess).write[Boolean] and
      (__ \ 'allowUpdate).write[Boolean] and
      (__ \ 'allowFinish).write[Boolean] and
      (__ \ 'allowDownload).write[Boolean])(ar =>
      (ar.allowAccess(u), ar.allowUpdate(u), ar.allowFinish(u), ar.allowDownload(u)))

  def restrictEverything =
    new AnnotationRestrictions()

  def defaultAnnotationRestrictions(annotation: AnnotationLike) =
    new AnnotationRestrictions {
      override def allowAccess(user: Option[User]) = {
        user.map {
          user =>
            annotation._user == user._id || (Role.Admin.map(user.hasRole) getOrElse false)
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
            (annotation._user == user._id || (Role.Admin.map(user.hasRole) getOrElse false)) && !annotation.state.isFinished
        } getOrElse false
      }

      override def allowDownload(user: Option[User]) = {
        user.map {
          user =>
            !annotation.isTrainingsAnnotation() && allowAccess(user)
        } getOrElse false
      }
    }
}
