package models.annotation

import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import javax.inject.Inject
import models.user.{User, UserService}
import play.api.libs.json._
import models.annotation.AnnotationState._

import scala.concurrent._
import ExecutionContext.Implicits.global

class AnnotationRestrictions {
  def allowAccess(user: Option[User]): Fox[Boolean] = Fox.successful(false)

  def allowUpdate(user: Option[User]): Fox[Boolean] = Fox.successful(false)

  def allowFinish(user: Option[User]): Fox[Boolean] = Fox.successful(false)

  def allowFinishSoft(user: Option[User]): Fox[Boolean] = allowFinish(user)

  def allowDownload(user: Option[User]): Fox[Boolean] = allowAccess(user)

  def allowAccess(user: User): Fox[Boolean] = allowAccess(Some(user))

  def allowUpdate(user: User): Fox[Boolean] = allowUpdate(Some(user))

  def allowFinish(user: User): Fox[Boolean] = allowFinish(Some(user))

  def allowFinishSoft(user: User): Fox[Boolean] = allowFinish(Some(user))

  def allowDownload(user: User): Fox[Boolean] = allowDownload(Some(user))
}

object AnnotationRestrictions extends FoxImplicits {
  def writeAsJson(ar: AnnotationRestrictions, u: Option[User]): Fox[JsObject] =
    for {
      allowAccess <- ar.allowAccess(u)
      allowUpdate <- ar.allowUpdate(u)
      allowFinish <- ar.allowFinish(u)
      allowDownload <- ar.allowDownload(u)
    } yield {
      Json.obj("allowAccess" -> allowAccess,
               "allowUpdate" -> allowUpdate,
               "allowFinish" -> allowFinish,
               "allowDownload" -> allowDownload)
    }
}

class AnnotationRestrictionDefaults @Inject()(userService: UserService) extends FoxImplicits {
  def restrictEverything =
    new AnnotationRestrictions()

  def defaultsFor(annotation: Annotation): AnnotationRestrictions =
    new AnnotationRestrictions {
      override def allowAccess(userOption: Option[User]): Fox[Boolean] =
        if (annotation.visibility == AnnotationVisibility.Public) Fox.successful(true)
        else if (annotation.visibility == AnnotationVisibility.Internal) {
          (for {
            user <- option2Fox(userOption)
            owner <- userService.findOneById(annotation._user, useCache = true)(GlobalAccessContext)
          } yield owner._organization == user._organization).orElse(Fox.successful(false))
        } else {
          (for {
            user <- option2Fox(userOption)
            isTeamManagerOrAdminOfTeam <- userService.isTeamManagerOrAdminOf(user, annotation._team)
          } yield annotation._user == user._id || isTeamManagerOrAdminOfTeam).orElse(Fox.successful(false))
        }

      override def allowUpdate(user: Option[User]): Fox[Boolean] =
        Fox.successful(user.exists { user =>
          annotation._user == user._id && !(annotation.state == Finished)
        })

      override def allowFinish(userOption: Option[User]): Fox[Boolean] =
        (for {
          user <- option2Fox(userOption)
          isTeamManagerOrAdminOfTeam <- userService.isTeamManagerOrAdminOf(user, annotation._team)
        } yield {
          (annotation._user == user._id || isTeamManagerOrAdminOfTeam) && !(annotation.state == Finished)
        }).orElse(Fox.successful(false))

      /* used in backend only to allow repeatable finish calls */
      override def allowFinishSoft(userOption: Option[User]): Fox[Boolean] =
        (for {
          user <- option2Fox(userOption)
          isTeamManagerOrAdminOfTeam <- userService.isTeamManagerOrAdminOf(user, annotation._team)
        } yield {
          annotation._user == user._id || isTeamManagerOrAdminOfTeam
        }).orElse(Fox.successful(false))
    }

}
