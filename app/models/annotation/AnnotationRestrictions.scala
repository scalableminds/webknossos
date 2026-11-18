package models.annotation

import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox

import javax.inject.Inject
import models.dataset.{Dataset, DatasetDAO, DatasetService}
import models.user.{User, UserService}
import play.api.libs.json.*
import models.annotation.AnnotationState.*
import utils.WkConf

import scala.concurrent.*

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

  def allowFinishSoft(user: User): Fox[Boolean] = allowFinishSoft(Some(user))

  def allowDownload(user: User): Fox[Boolean] = allowDownload(Some(user))
}

object AnnotationRestrictions {
  def writeAsJson(ar: AnnotationRestrictions, u: Option[User]): Fox[JsObject] =
    for {
      allowAccess <- ar.allowAccess(u)
      allowUpdate <- ar.allowUpdate(u)
      allowFinish <- ar.allowFinish(u)
      allowDownload <- ar.allowDownload(u)
    } yield Json.obj(
      "allowAccess" -> allowAccess,
      "allowUpdate" -> allowUpdate,
      "allowFinish" -> allowFinish,
      "allowDownload" -> allowDownload
    )
}

class AnnotationRestrictionDefaults @Inject() (
    userService: UserService,
    annotationMutexDAO: AnnotationMutexDAO,
    datasetDAO: DatasetDAO,
    datasetService: DatasetService,
    conf: WkConf
)(implicit
    ec: ExecutionContext
) {

  def defaultsFor(annotation: Annotation): AnnotationRestrictions =
    if (conf.Features.unifiedDatasets && annotation.typ == AnnotationType.Explorational)
      unifiedDatasetsAwareDefaultsFor(annotation)
    else legacyDefaultsFor(annotation)

  // Unified datasets prototype: a backing annotation (the one referenced by datasets._annotation) is not an object of
  // its own for users. Access follows the dataset's read access, editing follows the dataset's owner and edit rights.
  // All other annotations keep the legacy rules.
  private def unifiedDatasetsAwareDefaultsFor(annotation: Annotation): AnnotationRestrictions = {
    val legacy = legacyDefaultsFor(annotation)
    // Looked up once per restrictions object, not once per check.
    lazy val backingDatasetFox: Fox[Option[Dataset]] = datasetDAO.findOneByBackingAnnotation(annotation._id)

    def isBackingAnnotationEditor(dataset: Dataset, user: User): Fox[Boolean] =
      if (annotation._user == user._id || dataset._uploader.contains(user._id)) Fox.successful(true)
      else datasetService.isEditableBy(dataset, Some(user))

    def backingAllowAccess(dataset: Dataset, userOpt: Option[User]): Fox[Boolean] =
      userOpt match {
        case None       => Fox.successful(dataset.isPublic && annotation.visibility != AnnotationVisibility.Private)
        case Some(user) =>
          for {
            // Checked here and not by the caller, since the tracingstore authorizes by annotation id alone.
            datasetBox <- datasetDAO.findOne(dataset._id)(using AuthorizedAccessContext(user)).shiftBox
            mayPassPrivacy <-
              if (annotation.visibility != AnnotationVisibility.Private) Fox.successful(true)
              else if (annotation._user == user._id) Fox.successful(true)
              else
                (for {
                  owner <- userService.findOneCached(annotation._user)(using GlobalAccessContext)
                  isTeamManagerOrAdmin <- userService.isTeamManagerOrAdminOf(user, owner._organization, None)
                } yield isTeamManagerOrAdmin).orElse(Fox.successful(false))
          } yield datasetBox.isDefined && mayPassPrivacy
      }

    def backingAllowUpdate(dataset: Dataset, userOpt: Option[User]): Fox[Boolean] =
      userOpt match {
        case None       => Fox.successful(false)
        case Some(user) =>
          val annotationIsMutable = !(annotation.state == Finished) && !annotation.isLockedByOwner
          for {
            readAccessAllowed <- backingAllowAccess(dataset, userOpt)
            isEditor <- isBackingAnnotationEditor(dataset, user)
            ownerBox <- userService.findOneCached(annotation._user)(using GlobalAccessContext).shiftBox
            othersMayEditApplies = annotation.othersMayEdit && ownerBox.exists(_._organization == user._organization)
          } yield annotationIsMutable && readAccessAllowed && (isEditor || othersMayEditApplies)
      }

    new AnnotationRestrictions {
      private def onBackingOrLegacy(onBacking: Dataset => Fox[Boolean], onLegacy: => Fox[Boolean]): Fox[Boolean] =
        backingDatasetFox.flatMap {
          case Some(dataset) => onBacking(dataset)
          case None          => onLegacy
        }

      override def allowAccess(userOpt: Option[User]): Fox[Boolean] =
        onBackingOrLegacy(backingAllowAccess(_, userOpt), legacy.allowAccess(userOpt))

      override def allowUpdate(userOpt: Option[User]): Fox[Boolean] =
        onBackingOrLegacy(backingAllowUpdate(_, userOpt), legacy.allowUpdate(userOpt))

      override def allowUpdateWithMutex(userOpt: Option[User]): Fox[Boolean] =
        onBackingOrLegacy(
          dataset =>
            for {
              updateAccessAllowed <- backingAllowUpdate(dataset, userOpt)
              userHasMutex <- userOpt match {
                case Some(u) if annotation.othersMayEdit => annotationMutexDAO.hasMutex(u._id, annotation._id)
                case _                                   => Fox.successful(false)
              }
            } yield if (annotation.othersMayEdit) updateAccessAllowed && userHasMutex else updateAccessAllowed,
          legacy.allowUpdateWithMutex(userOpt)
        )

      override def allowFinish(userOpt: Option[User]): Fox[Boolean] = legacy.allowFinish(userOpt)

      override def allowFinishSoft(userOpt: Option[User]): Fox[Boolean] = legacy.allowFinishSoft(userOpt)

      override def allowDownload(userOpt: Option[User]): Fox[Boolean] =
        onBackingOrLegacy(backingAllowAccess(_, userOpt), legacy.allowDownload(userOpt))
    }
  }

  private def legacyDefaultsFor(annotation: Annotation): AnnotationRestrictions =
    new AnnotationRestrictions {
      override def allowAccess(userOption: Option[User]): Fox[Boolean] =
        if (annotation.visibility == AnnotationVisibility.Public) Fox.successful(true)
        else if (annotation.visibility == AnnotationVisibility.Internal) {
          (for {
            user <- userOption.toFox
            owner <- userService.findOneCached(annotation._user)(using GlobalAccessContext)
          } yield owner._organization == user._organization).orElse(Fox.successful(false))
        } else {
          (for {
            user <- userOption.toFox
            owner <- userService.findOneCached(annotation._user)(using GlobalAccessContext)
            isTeamManagerOrAdminOfTeam <- userService.isTeamManagerOrAdminOf(
              user,
              owner._organization,
              annotation._task
            )
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
            .findOneCached(annotation._user)(using GlobalAccessContext)
            .shiftBox // sandbox annotations have no owner
          annotationIsMutable = !(annotation.state == Finished) && !annotation.isLockedByOwner
        } yield userOpt.exists { user =>
          if (annotation.othersMayEdit) {
            val isInSameOrga = annotationOwnerBox.exists(_._organization == user._organization)
            annotationIsMutable && isInSameOrga && readAccessAllowed
          } else annotationIsMutable && annotation._user == user._id
        }

      override def allowFinish(userOption: Option[User]): Fox[Boolean] =
        (for {
          user <- userOption.toFox
          owner <- userService.findOneCached(annotation._user)(using GlobalAccessContext)
          isTeamManagerOrAdminOfTeam <- userService.isTeamManagerOrAdminOf(user, owner._organization, annotation._task)
        } yield (annotation._user == user._id || isTeamManagerOrAdminOfTeam) && !(annotation.state == Finished) && !annotation.isLockedByOwner)
          .orElse(Fox.successful(false))

      /* used in backend only to allow repeatable finish calls */
      override def allowFinishSoft(userOption: Option[User]): Fox[Boolean] =
        (for {
          user <- userOption.toFox
          owner <- userService.findOneCached(annotation._user)(using GlobalAccessContext)
          isTeamManagerOrAdminOfTeam <- userService.isTeamManagerOrAdminOf(user, owner._organization, annotation._task)
        } yield (annotation._user == user._id || isTeamManagerOrAdminOfTeam) && !annotation.isLockedByOwner)
          .orElse(Fox.successful(false))
    }

}
