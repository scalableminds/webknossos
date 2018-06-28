package models.annotation

import com.scalableminds.util.reactivemongo.GlobalAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import javax.management.relation.Role
import models.user.User
import play.api.libs.json._
import models.annotation.AnnotationState._
import utils.ObjectId
import scala.concurrent._
import ExecutionContext.Implicits.global

import scala.concurrent.Future

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 02.06.13
 * Time: 02:02
 */

class AnnotationRestrictions {
  def allowAccess(user: Option[User]): Fox[Boolean] = Fox.successful(false)

  def allowUpdate(user: Option[User]): Fox[Boolean] = Fox.successful(false)

  def allowFinish(user: Option[User]): Fox[Boolean] = Fox.successful(false)

  def allowDownload(user: Option[User]): Fox[Boolean] = allowAccess(user)

  def allowAccess(user: User): Fox[Boolean] = allowAccess(Some(user))

  def allowUpdate(user: User): Fox[Boolean] = allowUpdate(Some(user))

  def allowFinish(user: User): Fox[Boolean] = allowFinish(Some(user))

  def allowDownload(user: User): Fox[Boolean] = allowDownload(Some(user))
}

object AnnotationRestrictions extends FoxImplicits{
  def writeAsJson(ar: AnnotationRestrictions, u: Option[User]) : Fox[JsObject] =
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
      override def allowAccess(userOption: Option[User]) = {
        if(annotation.isPublic) Fox.successful(true)
        else
          (for {
            user <- option2Fox(userOption)
            teamBSONObjectId <- option2Fox(annotation._team.toBSONObjectId)
            isTeamManagerOrAdminOf <- user.isTeamManagerOrAdminOf(teamBSONObjectId)
          } yield {
            annotation._user == ObjectId.fromBsonId(user._id) || isTeamManagerOrAdminOf
          }).orElse(Fox.successful(false))
      }

      override def allowUpdate(user: Option[User]) = {
        Fox.successful(user.exists {
          user =>
            annotation._user == ObjectId.fromBsonId(user._id) && !(annotation.state == Finished)
        })
      }

      override def allowFinish(user: Option[User]) = {
        (for {
          u <- option2Fox(user)
          teamBSONObjectId <- option2Fox(annotation._team.toBSONObjectId)
          isTeamManagerOrAdminOf <- u.isTeamManagerOrAdminOf(teamBSONObjectId)
        } yield {
          (annotation._user == ObjectId.fromBsonId(u._id) || isTeamManagerOrAdminOf) && !(annotation.state == Finished)
        }).orElse(Fox.successful(false))
      }
    }

  def readonlyAnnotation() =
    new AnnotationRestrictions {
      override def allowAccess(user: Option[User]) = Fox.successful(true)
    }

  def updateableAnnotation() =
    new AnnotationRestrictions {
      override def allowAccess(user: Option[User]) = Fox.successful(true)
      override def allowUpdate(user: Option[User]) = Fox.successful(true)
      override def allowFinish(user: Option[User]) = Fox.successful(true)
    }
}
