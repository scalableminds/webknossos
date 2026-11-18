package models.dataset

import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, DBAccessContext}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.box.{Empty, Failure, Full}
import models.annotation.{
  AnnotationDAO,
  AnnotationRestrictionDefaults,
  AnnotationService,
  AnnotationType,
  AnnotationVisibility
}
import com.scalableminds.util.Msg
import models.annotation.TracingStoreService
import models.organization.OrganizationDAO
import models.team.{TeamDAO, TeamService}
import models.user.{User, UserDAO}
import play.api.libs.json.{JsArray, JsObject, Json, OFormat}

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

case class CopyDatasetRequest(name: String, layerNames: Option[Seq[String]], includeAnnotationLayers: Boolean)
object CopyDatasetRequest {
  implicit val jsonFormat: OFormat[CopyDatasetRequest] = Json.format[CopyDatasetRequest]
}

// Properties a copy takes over. Copies take them from their source, converted annotations partly from the annotation.
case class CopyProperties(
    owner: User,
    name: String,
    layerNames: Option[Seq[String]],
    description: Option[String],
    tags: List[String],
    createdOpt: Option[Instant] = None
)

// Unified datasets prototype (features.unifiedDatasets). Each dataset may be bound to one explorational "backing"
// annotation, referenced by datasets._annotation, that holds its annotation layers.
class UnifiedDatasetService @Inject() (
    datasetDAO: DatasetDAO,
    datasetService: DatasetService,
    annotationDAO: AnnotationDAO,
    annotationService: AnnotationService,
    annotationRestrictionDefaults: AnnotationRestrictionDefaults,
    composeService: ComposeService,
    datasetLayerOriginDAO: DatasetLayerOriginDAO,
    organizationDAO: OrganizationDAO,
    teamDAO: TeamDAO,
    teamService: TeamService,
    userDAO: UserDAO,
    tracingStoreService: TracingStoreService
)(implicit ec: ExecutionContext)
    extends LazyLogging {

  // D2, for datasets that have no backing annotation yet.
  private def mayEditAnnotationLayers(dataset: Dataset, user: User): Fox[Boolean] =
    for {
      owner <- datasetService.ownerFor(dataset).shiftBox
      isEditable <- datasetService.isEditableBy(dataset, Some(user))
    } yield owner.exists(_._id == user._id) || isEditable

  // The caller must have checked read access on the dataset.
  def findOrCreateBackingAnnotation(dataset: Dataset, userOpt: Option[User]): Fox[BackingAnnotationInfo] =
    dataset._annotation match {
      case Some(annotationId) => accessInfoFor(annotationId, userOpt)
      case None               =>
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
      owner <- datasetService.ownerFor(dataset) ?~> "unifiedDatasets.ownerNotFound"
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

  // B3. The caller must have checked that the user may read the source dataset. Returns the new dataset's id.
  def copyDataset(source: Dataset, user: User, request: CopyDatasetRequest): Fox[ObjectId] =
    for {
      sourceAnnotationOpt <-
        if (request.includeAnnotationLayers) readableBackingAnnotationOf(source, user)
        else Fox.successful(None)
      // Volume layers may extend a segmentation layer, which is referenced by name. To keep them working, all data
      // layers are linked if volume layers are copied.
      copiesVolumeLayers = sourceAnnotationOpt.exists(_.volumeAnnotationLayers.nonEmpty)
      newDatasetId <- createCopy(
        source,
        CopyProperties(
          user,
          request.name,
          if (copiesVolumeLayers) None else request.layerNames,
          source.description,
          source.tags
        )
      )
      newDataset <- datasetDAO.findOne(newDatasetId)(using GlobalAccessContext)
      _ <- sourceAnnotationOpt match {
        case Some(sourceAnnotation) => bindDuplicateOfAnnotation(sourceAnnotation, newDataset, user)
        case None                   => createEmptyBackingAnnotation(newDataset, user)
      }
    } yield newDatasetId

  private def readableBackingAnnotationOf(dataset: Dataset, user: User): Fox[Option[models.annotation.Annotation]] =
    dataset._annotation match {
      case None               => Fox.successful(None)
      case Some(annotationId) =>
        for {
          annotation <- annotationDAO.findOne(annotationId)(using GlobalAccessContext)
          mayRead <- annotationRestrictionDefaults.defaultsFor(annotation).allowAccess(Some(user))
        } yield if (mayRead && annotation.annotationLayers.nonEmpty) Some(annotation) else None
    }

  private def bindDuplicateOfAnnotation(
      sourceAnnotation: models.annotation.Annotation,
      targetDataset: Dataset,
      owner: User
  ): Fox[ObjectId] =
    for {
      duplicate <- annotationService.duplicateAnnotation(sourceAnnotation, owner, Some(targetDataset))
      _ <- annotationDAO.updateVisibility(duplicate._id, AnnotationVisibility.Public)(using GlobalAccessContext)
      claimed <- datasetDAO.claimBackingAnnotation(targetDataset._id, duplicate._id)
      _ <- Fox.fromBool(claimed) ?~> "unifiedDatasets.copy.backingAnnotationAlreadyBound"
    } yield duplicate._id

  // Creates a virtual dataset that links the given layers of the source (all by default), owned by properties.owner,
  // with origin rows per linked layer. Does not touch annotation layers.
  def createCopy(source: Dataset, properties: CopyProperties): Fox[ObjectId] = {
    given ctx: DBAccessContext = GlobalAccessContext
    val owner = properties.owner
    val isSameOrganization = owner._organization == source._organization
    for {
      sourceDataSource <- datasetService.usableDataSourceFor(source) ?~> "unifiedDatasets.copy.sourceNotUsable"
      allLayerNames = sourceDataSource.dataLayers.map(_.name)
      layerNames = properties.layerNames.getOrElse(allLayerNames)
      _ <- Fox.fromBool(layerNames.nonEmpty) ?~> "A copy needs at least one data layer."
      _ <- Fox.fromBool(layerNames.forall(allLayerNames.contains)) ?~> "unifiedDatasets.copy.unknownLayer"
      // Copies across organizations (of public datasets) land in the copying user's root folder.
      ownerOrganization <- organizationDAO.findOne(owner._organization)
      targetFolderId = if (isSameOrganization) source._folder else ownerOrganization._rootFolder
      composeRequest = ComposeRequest(
        properties.name,
        targetFolderId,
        owner._organization,
        sourceDataSource.scale,
        layerNames.map(layerName => ComposeRequestLayer(source._id, layerName, layerName, None))
      )
      (_, newDatasetId) <- composeService.composeDataset(composeRequest, owner, skipFolderAccessCheck = true)(using
        AuthorizedAccessContext(owner)
      )
      _ <- datasetDAO.updateCopyProperties(
        newDatasetId,
        copiedFrom = source._id,
        isPublic = source.isPublic,
        description = properties.description,
        tags = properties.tags,
        metadata = if (isSameOrganization) source.metadata else JsArray.empty,
        createdOpt = properties.createdOpt
      )
      sourceTeamIds <- teamService.allowedTeamIdsForDataset(source, cumulative = false)
      _ <- Fox.runIf(isSameOrganization)(teamDAO.updateAllowedTeamsForDataset(newDatasetId, sourceTeamIds))
      // The origin always names where the data really lives, also for copies of copies.
      sourceOrigins <- datasetLayerOriginDAO.findAllForDataset(source._id)
      origins = layerNames.map { layerName =>
        sourceOrigins.find(_.layerName == layerName) match {
          case Some(o) => DatasetLayerOrigin(newDatasetId, layerName, o._sourceDataset, o.sourceLayerName)
          case None    => DatasetLayerOrigin(newDatasetId, layerName, source._id, layerName)
        }
      }
      _ <- datasetLayerOriginDAO.insertAll(origins)
    } yield newDatasetId
  }

  // 4.6: turns an explorational annotation into a dataset that links all layers of the annotation's dataset and is
  // backed by the annotation. Idempotent: returns the existing dataset if the annotation is a backing annotation.
  // Returns None for annotations that are not converted (tasks, deleted ones).
  def convertAnnotation(annotationId: ObjectId): Fox[Option[Dataset]] = {
    given ctx: DBAccessContext = GlobalAccessContext
    for {
      annotation <- annotationDAO.findOne(annotationId) ?~> "unifiedDatasets.convert.annotationNotFound"
      existingDatasetOpt <- datasetDAO.findOneByBackingAnnotation(annotationId)
      resultOpt <- existingDatasetOpt match {
        case Some(existing) => Fox.successful(Some(existing))
        case None if annotation.typ != AnnotationType.Explorational || annotation.isDeleted => Fox.successful(None)
        case None                                                                           =>
          for {
            source <- datasetDAO.findOne(annotation._dataset) ?~> "unifiedDatasets.convert.datasetNotFound"
            _ <- Fox.fromBool(source.isUsable) ?~> "unifiedDatasets.convert.datasetNotUsable"
            owner <- userDAO.findOne(annotation._user) ?~> "unifiedDatasets.convert.ownerNotFound"
            newDatasetId <- createCopy(
              source,
              CopyProperties(
                owner,
                convertedDatasetName(annotation, source),
                layerNames = None,
                description = if (annotation.description.nonEmpty) Some(annotation.description) else source.description,
                tags = annotation.tags.toList.sorted,
                createdOpt = Some(annotation.created)
              )
            )
            _ <- datasetDAO.bindConvertedAnnotation(annotationId, newDatasetId)
            _ <- datasetDAO.copyUserDatasetConfigurations(owner._id, source._id, newDatasetId)
            newDataset <- datasetDAO.findOne(newDatasetId)
          } yield Some(newDataset)
      }
    } yield resultOpt
  }

  // Dataset names are restricted to [A-Za-z0-9_\-.] with at least three characters, annotation names are not.
  private def convertedDatasetName(annotation: models.annotation.Annotation, source: Dataset): String = {
    val fallback = s"${source.name}_annotation_${annotation._id.toString.takeRight(6)}"
    val sanitized = annotation.name.trim.replaceAll("[^A-Za-z0-9_\\-.]+", "_").stripPrefix(".")
    if (sanitized.length >= 3) sanitized else fallback
  }

  // Batch conversion for trying the prototype on a full dev database. Runs serially and reports per annotation.
  def convertAnnotations(organizationIdOpt: Option[String], limit: Int): Fox[JsObject] =
    for {
      annotationIds <- datasetDAO.findConvertibleAnnotationIds(organizationIdOpt, limit)
      results <- Fox.serialCombined(annotationIds.toList) { annotationId =>
        convertAnnotation(annotationId).shiftBox.map(box => annotationId -> box)
      }
    } yield {
      val converted = results.collect { case (id, Full(Some(dataset))) =>
        Json.obj("annotationId" -> id, "datasetId" -> dataset._id)
      }
      val skipped = results.collect { case (id, Full(None)) => id }
      val failed = results.collect {
        case (id, f: Failure) => Json.obj("annotationId" -> id, "error" -> f.msg)
        case (id, Empty)      => Json.obj("annotationId" -> id, "error" -> "empty")
      }
      logger.info(
        s"Converted ${converted.length} annotations to datasets, skipped ${skipped.length}, failed ${failed.length}."
      )
      Json.obj(
        "convertedCount" -> converted.length,
        "skippedCount" -> skipped.length,
        "failedCount" -> failed.length,
        "converted" -> converted,
        "skipped" -> skipped,
        "failed" -> failed
      )
    }

  // B5: records where a layer added via compose/addLayer really lives (the source's own origin if it has one).
  def recordAddedLayerOrigin(targetDatasetId: ObjectId, request: ComposeRequestLayer): Fox[Unit] =
    for {
      sourceOrigins <- datasetLayerOriginDAO.findAllForDataset(request.sourceDatasetId)
      origin = sourceOrigins.find(_.layerName == request.sourceLayerName) match {
        case Some(o) =>
          DatasetLayerOrigin(targetDatasetId, request.targetLayerName, o._sourceDataset, o.sourceLayerName)
        case None =>
          DatasetLayerOrigin(targetDatasetId, request.targetLayerName, request.sourceDatasetId, request.sourceLayerName)
      }
      _ <- datasetLayerOriginDAO.insertAll(Seq(origin))
    } yield ()

  // B5: removes a data layer from a virtual dataset. Layers that a volume annotation layer extends cannot be removed.
  def removeDataLayer(dataset: Dataset, user: User, layerName: String): Fox[Unit] = {
    given ctx: DBAccessContext = GlobalAccessContext
    for {
      _ <- datasetService.assertEditableBy(dataset, user)
      _ <- Fox.fromBool(dataset.isVirtual) ?~> Msg.Dataset.Compose.inPlaceMustBeVirtual
      dataSource <- datasetService.usableDataSourceFor(dataset)
      _ <- Fox.fromBool(dataSource.dataLayers.exists(_.name == layerName)) ?~> s"Data layer $layerName not found."
      _ <- Fox.fromBool(dataSource.dataLayers.length > 1) ?~> "A dataset needs at least one data layer."
      extendedLayerNames <- layerNamesExtendedByVolumeLayers(dataset)
      _ <- Fox.fromBool(!extendedLayerNames.contains(layerName)) ?~>
        s"The data layer $layerName is extended by a volume annotation layer. Remove that annotation layer first."
      _ <- datasetService.updateDataSourceFromUserChanges(
        dataset,
        dataSource.copy(dataLayers = dataSource.dataLayers.filterNot(_.name == layerName)),
        Seq.empty,
        Seq.empty
      )
      _ <- datasetLayerOriginDAO.deleteOne(dataset._id, layerName)
      updated <- datasetDAO.findOne(dataset._id)
      _ <- datasetService.scanRealpathsIfVirtual(updated)
      _ <- datasetService.writeMirrorForVirtual(updated)
    } yield ()
  }

  private def layerNamesExtendedByVolumeLayers(dataset: Dataset): Fox[Seq[String]] =
    dataset._annotation match {
      case None               => Fox.successful(Seq.empty)
      case Some(annotationId) =>
        for {
          annotation <- annotationDAO.findOne(annotationId)(using GlobalAccessContext)
          volumeLayers = annotation.volumeAnnotationLayers
          fallbackNames <-
            if (volumeLayers.isEmpty) Fox.successful(Seq.empty)
            else
              for {
                client <- tracingStoreService.clientFor(dataset)
                tracings <- client.getVolumeTracings(volumeLayers.map(l => Some(l.tracingId)))
              } yield tracings.tracings.flatMap(_.tracing).flatMap(_.fallbackLayer)
        } yield fallbackNames
    }
}
