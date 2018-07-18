package models.annotation

import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import javax.management.relation.Role
import models.user.UserSQL
import play.api.libs.json._
import models.annotation.AnnotationState._
import utils.ObjectId

import scala.concurrent._
import ExecutionContext.Implicits.global


class AnnotationRestrictions {
  def allowAccess(user: Option[UserSQL]): Fox[Boolean] = Fox.successful(false)

  def allowUpdate(user: Option[UserSQL]): Fox[Boolean] = Fox.successful(false)

  def allowFinish(user: Option[UserSQL]): Fox[Boolean] = Fox.successful(false)

  def allowDownload(user: Option[UserSQL]): Fox[Boolean] = allowAccess(user)

  def allowAccess(user: UserSQL): Fox[Boolean] = allowAccess(Some(user))

  def allowUpdate(user: UserSQL): Fox[Boolean] = allowUpdate(Some(user))

  def allowFinish(user: UserSQL): Fox[Boolean] = allowFinish(Some(user))

  def allowDownload(user: UserSQL): Fox[Boolean] = allowDownload(Some(user))
}

object AnnotationRestrictions extends FoxImplicits{
  def writeAsJson(ar: AnnotationRestrictions, u: Option[UserSQL]) : Fox[JsObject] =
    for {
      allowAccess <- ar.allowAccess(u)
      allowUpdate <- ar.allowUpdate(u)
      allowFinish <- ar.allowFinish(u)
      allowDownload <- ar.allowDownload(u)
    } yield {
      Json.obj(
        "allowAccess" -> allowAccess,
        "allowUpdate" -> allowUpdate,
        "allowFinish" -> allowFinish,
        "allowDownload" -> allowDownload)
    }

  def restrictEverything =
    new AnnotationRestrictions()

  def defaultAnnotationRestrictions(annotation: AnnotationSQL): AnnotationRestrictions =
    new AnnotationRestrictions {
      override def allowAccess(userOption: Option[UserSQL]) = {
        if(annotation.isPublic) Fox.successful(true)
        else
          (for {
            user <- option2Fox(userOption)
            isTeamManagerOrAdminOfTeam <- user.isTeamManagerOrAdminOf(annotation._team)
          } yield {
            annotation._user == user._id || isTeamManagerOrAdminOfTeam
          }).orElse(Fox.successful(false))
      }

      override def allowUpdate(user: Option[UserSQL]) = {
        Fox.successful(user.exists {
          user =>
            annotation._user == user._id && !(annotation.state == Finished)
        })
      }

      override def allowFinish(user: Option[UserSQL]) = {
        (for {
          u <- option2Fox(user)
          isTeamManagerOrAdminOfTeam <- u.isTeamManagerOrAdminOf(annotation._team)
        } yield {
          (annotation._user == u._id || isTeamManagerOrAdminOfTeam) && !(annotation.state == Finished)
        }).orElse(Fox.successful(false))
      }
    }

  def readonlyAnnotation() =
    new AnnotationRestrictions {
      override def allowAccess(user: Option[UserSQL]) = Fox.successful(true)
    }

  def updateableAnnotation() =
    new AnnotationRestrictions {
      override def allowAccess(user: Option[UserSQL]) = Fox.successful(true)
      override def allowUpdate(user: Option[UserSQL]) = Fox.successful(true)
      override def allowFinish(user: Option[UserSQL]) = Fox.successful(true)
    }
}
