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
  def allowAccess(user: User): Boolean = false

  def allowUpdate(user: User): Boolean = false

  def allowFinish(user: User): Boolean = false

  def allowDownload(user: User): Boolean = false
}

object AnnotationRestrictions {
  def writeFor(u: User): Writes[AnnotationRestrictions] =
    ((__ \'allowAccess).write[Boolean] and
    (__ \'allowUpdate).write[Boolean] and
    (__ \'allowFinish).write[Boolean] and
    (__ \'allowDownload).write[Boolean])( ar =>
      (ar.allowAccess(u), ar.allowUpdate(u), ar.allowFinish(u), ar.allowDownload(u)))

  def restrictEverything =
    new AnnotationRestrictions()

  def defaultAnnotationRestrictions(annotation: AnnotationLike) =
    new AnnotationRestrictions {
      override def allowAccess(user: User) = {
        annotation._user == user._id || (Role.Admin.map(user.hasRole) getOrElse false)
      }

      override def allowUpdate(user: User) = {
        annotation._user == user._id
      }

      override def allowFinish(user: User) = {
        annotation._user == user._id || (Role.Admin.map(user.hasRole) getOrElse false)
      }

      override def allowDownload(user: User) = {
        !annotation.isTrainingsAnnotation() && allowAccess(user)
      }
    }
}
