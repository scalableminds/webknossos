package models.annotation

import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}

import javax.inject.Inject
import models.user.{User, UserService}
import play.api.libs.json._
import models.annotation.AnnotationState._

import scala.concurrent._

class AnnotationRestrictions(implicit ec: ExecutionContext) {
  def allowAccess(user: Option[User]): Fox[Boolean] = Fox.successful(false)

  // Ignores state of annotation mutex. Use allowUpdateWithMutex for updates that should only be allowed with the mutex.
  def allowUpdate(user: Option[User]): Fox[Boolean] = Fox.successful(false)

  def allowUpdateWithMutex(user: Option[User]): Fox[Boolean] = Fox.successful(false)

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

class AnnotationRestrictionDefaults @Inject()(userService: UserService, annotationMutexDAO: AnnotationMutexDAO)(
    implicit ec: ExecutionContext)
    extends FoxImplicits {

  def defaultsFor(annotation: Annotation): AnnotationRestrictions =
    new AnnotationRestrictions {
      override def allowAccess(userOption: Option[User]): Fox[Boolean] =
        if (annotation.visibility == AnnotationVisibility.Public) Fox.successful(true)
        else if (annotation.visibility == AnnotationVisibility.Internal) {
          (for {
            user <- userOption.toFox
            owner <- userService.findOneCached(annotation._user)(GlobalAccessContext)
          } yield owner._organization == user._organization).orElse(Fox.successful(false))
        } else {
          (for {
            user <- userOption.toFox
            owner <- userService.findOneCached(annotation._user)(GlobalAccessContext)
            isTeamManagerOrAdminOfTeam <- userService.isTeamManagerOrAdminOf(user,
                                                                             owner._organization,
                                                                             annotation._task)
          } yield annotation._user == user._id || isTeamManagerOrAdminOfTeam).orElse(Fox.successful(false))
        }

      override def allowUpdateWithMutex(userOpt: Option[User]): Fox[Boolean] =
        for {
          updateAccessAllowed <- allowUpdate(userOpt)
          userHasMutex <- userOpt match {
            case Some(_) if !annotation.othersMayEdit => Fox.successful(false)
            case Some(u)                              => annotationMutexDAO.hasMutex(u._id, annotation._id)
            case None                                 => Fox.successful(false)
          }
        } yield if (annotation.othersMayEdit) updateAccessAllowed && userHasMutex else updateAccessAllowed

      override def allowUpdate(userOpt: Option[User]): Fox[Boolean] =
        for {
          readAccessAllowed <- allowAccess(userOpt)
          annotationOwnerBox <- userService
            .findOneCached(annotation._user)(GlobalAccessContext)
            .shiftBox // sandbox annotations have no owner
          annotationIsMutable = !(annotation.state == Finished) && !annotation.isLockedByOwner
        } yield
          userOpt.exists { user =>
            if (annotation.othersMayEdit) {
              val isInSameOrga = annotationOwnerBox.exists(_._organization == user._organization)
              annotationIsMutable && isInSameOrga && readAccessAllowed
            } else annotationIsMutable && annotation._user == user._id
          }

      override def allowFinish(userOption: Option[User]): Fox[Boolean] =
        (for {
          user <- userOption.toFox
          owner <- userService.findOneCached(annotation._user)(GlobalAccessContext)
          isTeamManagerOrAdminOfTeam <- userService.isTeamManagerOrAdminOf(user, owner._organization, annotation._task)
        } yield {
          (annotation._user == user._id || isTeamManagerOrAdminOfTeam) && !(annotation.state == Finished) && !annotation.isLockedByOwner
        }).orElse(Fox.successful(false))

      /* used in backend only to allow repeatable finish calls */
      override def allowFinishSoft(userOption: Option[User]): Fox[Boolean] =
        (for {
          user <- userOption.toFox
          owner <- userService.findOneCached(annotation._user)(GlobalAccessContext)
          isTeamManagerOrAdminOfTeam <- userService.isTeamManagerOrAdminOf(user, owner._organization, annotation._task)
        } yield {
          (annotation._user == user._id || isTeamManagerOrAdminOfTeam) && !annotation.isLockedByOwner
        }).orElse(Fox.successful(false))
    }

}
