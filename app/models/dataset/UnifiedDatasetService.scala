package models.dataset

import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.typesafe.scalalogging.LazyLogging
import models.annotation.{AnnotationDAO, AnnotationRestrictionDefaults, AnnotationService, AnnotationVisibility}
import models.user.{User, UserDAO}
import play.api.libs.json.{Json, OFormat}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

// "edit": may change annotation layers. "read": may see them. "none": the backing annotation is private.
case class BackingAnnotationInfo(annotationId: Option[ObjectId], access: String)
object BackingAnnotationInfo {
  implicit val jsonFormat: OFormat[BackingAnnotationInfo] = Json.format[BackingAnnotationInfo]

  val accessEdit = "edit"
  val accessRead = "read"
  val accessNone = "none"
}

// Unified datasets prototype (features.unifiedDatasets). Each dataset may be bound to one explorational "backing"
// annotation, referenced by datasets._annotation, that holds its annotation layers.
class UnifiedDatasetService @Inject() (
    datasetDAO: DatasetDAO,
    datasetService: DatasetService,
    annotationDAO: AnnotationDAO,
    annotationService: AnnotationService,
    annotationRestrictionDefaults: AnnotationRestrictionDefaults,
    userDAO: UserDAO
)(implicit ec: ExecutionContext)
    extends LazyLogging {

  // D1: the uploader, or the organization owner for datasets without one (disk scans, old data).
  def ownerFor(dataset: Dataset): Fox[User] =
    dataset._uploader match {
      case Some(uploaderId) =>
        userDAO
          .findOne(uploaderId)(using GlobalAccessContext)
          .orElse(userDAO.findOneOrganizationOwner(dataset._organization))
      case None => userDAO.findOneOrganizationOwner(dataset._organization)
    }

  // D2, for datasets that have no backing annotation yet.
  private def mayEditAnnotationLayers(dataset: Dataset, user: User): Fox[Boolean] =
    for {
      owner <- ownerFor(dataset).shiftBox
      isEditable <- datasetService.isEditableBy(dataset, Some(user))
    } yield owner.exists(_._id == user._id) || isEditable

  // The caller must have checked read access on the dataset.
  def findOrCreateBackingAnnotation(dataset: Dataset, userOpt: Option[User]): Fox[BackingAnnotationInfo] =
    dataset._annotation match {
      case Some(annotationId) => accessInfoFor(annotationId, userOpt)
      case None =>
        userOpt match {
          case Some(user) =>
            for {
              mayEdit <- mayEditAnnotationLayers(dataset, user)
              info <-
                if (mayEdit) createBackingAnnotation(dataset, userOpt)
                else Fox.successful(BackingAnnotationInfo(None, BackingAnnotationInfo.accessRead))
            } yield info
          case None => Fox.successful(BackingAnnotationInfo(None, BackingAnnotationInfo.accessRead))
        }
    }

  private def createBackingAnnotation(dataset: Dataset, userOpt: Option[User]): Fox[BackingAnnotationInfo] =
    for {
      owner <- ownerFor(dataset) ?~> "unifiedDatasets.ownerNotFound"
      annotationId <- createEmptyBackingAnnotation(dataset, owner)
      info <- accessInfoFor(annotationId, userOpt)
    } yield info

  // Creates an annotation without layers and binds it to the dataset. If another request bound one first, the new
  // annotation is discarded and the winner is returned.
  def createEmptyBackingAnnotation(dataset: Dataset, owner: User): Fox[ObjectId] =
    for {
      annotation <- annotationService.createExplorationalFor(owner, dataset, List.empty)(using GlobalAccessContext)
      // Visibility "Public" adds no access on top of the dataset's read access for backing annotations (D4), but lets
      // users of other organizations and anonymous viewers of public datasets load the annotation layers.
      _ <- annotationDAO.updateVisibility(annotation._id, AnnotationVisibility.Public)(using GlobalAccessContext)
      claimed <- datasetDAO.claimBackingAnnotation(dataset._id, annotation._id)
      boundAnnotationId <-
        if (claimed) Fox.successful(annotation._id)
        else
          for {
            _ <- annotationDAO.deleteOne(annotation._id)(using GlobalAccessContext)
            reloaded <- datasetDAO.findOne(dataset._id)(using GlobalAccessContext)
            winner <- reloaded._annotation.toFox ?~> "unifiedDatasets.backingAnnotationMissing"
          } yield winner
    } yield boundAnnotationId

  private def accessInfoFor(annotationId: ObjectId, userOpt: Option[User]): Fox[BackingAnnotationInfo] =
    for {
      annotation <- annotationDAO.findOne(annotationId)(using GlobalAccessContext)
      restrictions = annotationRestrictionDefaults.defaultsFor(annotation)
      allowUpdate <- restrictions.allowUpdate(userOpt)
      allowAccess <- restrictions.allowAccess(userOpt)
    } yield
      if (allowUpdate) BackingAnnotationInfo(Some(annotationId), BackingAnnotationInfo.accessEdit)
      else if (allowAccess) BackingAnnotationInfo(Some(annotationId), BackingAnnotationInfo.accessRead)
      else if (annotation.visibility == AnnotationVisibility.Private)
        BackingAnnotationInfo(Some(annotationId), BackingAnnotationInfo.accessNone)
      // Known gap: viewers with only a dataset sharing token can read the dataset, but not its annotation layers.
      else BackingAnnotationInfo(None, BackingAnnotationInfo.accessRead)
}
