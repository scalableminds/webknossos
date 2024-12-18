package models.annotation

import org.apache.pekko.actor.ActorSystem
import org.apache.pekko.stream.Materializer
import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.io.{NamedStream, ZipIO}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{BoxImplicits, Fox, FoxImplicits, TextUtils}
import com.scalableminds.webknossos.datastore.SkeletonTracing._
import com.scalableminds.webknossos.datastore.VolumeTracing.{VolumeTracing, VolumeTracingOpt, VolumeTracings}
import com.scalableminds.webknossos.datastore.geometry.{
  AdditionalCoordinateProto,
  ColorProto,
  NamedBoundingBoxProto,
  Vec3DoubleProto,
  Vec3IntProto
}
import com.scalableminds.webknossos.datastore.helpers.{NodeDefaults, ProtoGeometryImplicits, SkeletonTracingDefaults}
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.annotation.{
  AnnotationLayer,
  AnnotationLayerStatistics,
  AnnotationLayerType,
  AnnotationSource,
  FetchedAnnotationLayer
}
import com.scalableminds.webknossos.datastore.models.datasource.{
  AdditionalAxis,
  ElementClass,
  DataSourceLike => DataSource,
  SegmentationLayerLike => SegmentationLayer
}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.tracingstore.tracings._
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeDataZipFormat.VolumeDataZipFormat
import com.scalableminds.webknossos.tracingstore.tracings.volume.{
  MagRestrictions,
  VolumeDataZipFormat,
  VolumeTracingDefaults,
  VolumeTracingDownsampling
}
import com.typesafe.scalalogging.LazyLogging
import controllers.AnnotationLayerParameters
import models.annotation.AnnotationState._
import models.annotation.AnnotationType.AnnotationType
import models.annotation.handler.SavedTracingInformationHandler
import models.annotation.nml.NmlWriter
import models.dataset._
import models.organization.OrganizationDAO
import models.project.ProjectDAO
import models.task.{Task, TaskDAO, TaskService, TaskTypeDAO}
import models.team.{TeamDAO, TeamService}
import models.user.{User, UserDAO, UserService}
import net.liftweb.common.{Box, Full}
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.Files.{TemporaryFile, TemporaryFileCreator}
import play.api.libs.json.{JsNull, JsObject, JsValue, Json}
import utils.WkConf

import java.io.{BufferedOutputStream, File, FileOutputStream}
import javax.inject.Inject
import scala.concurrent.{ExecutionContext, Future}

case class DownloadAnnotation(skeletonTracingIdOpt: Option[String],
                              volumeTracingIdOpt: Option[String],
                              skeletonTracingOpt: Option[SkeletonTracing],
                              volumeTracingOpt: Option[VolumeTracing],
                              volumeDataOpt: Option[Array[Byte]],
                              name: String,
                              voxelSizeOpt: Option[VoxelSize],
                              annotation: Annotation,
                              user: User,
                              taskOpt: Option[Task],
                              organizationId: String,
                              datasetName: String,
                              datasetId: ObjectId)

// Used to pass duplicate properties when creating a new tracing to avoid masking them.
// Uses the proto-generated geometry classes, hence the full qualifiers.
case class RedundantTracingProperties(
    editPosition: Vec3IntProto,
    editRotation: Vec3DoubleProto,
    zoomLevel: Double,
    userBoundingBoxes: Seq[NamedBoundingBoxProto],
    editPositionAdditionalCoordinates: Seq[AdditionalCoordinateProto],
)

class AnnotationService @Inject()(
    annotationInformationProvider: AnnotationInformationProvider,
    savedTracingInformationHandler: SavedTracingInformationHandler,
    annotationDAO: AnnotationDAO,
    annotationLayersDAO: AnnotationLayerDAO,
    userDAO: UserDAO,
    taskTypeDAO: TaskTypeDAO,
    taskService: TaskService,
    datasetService: DatasetService,
    datasetDAO: DatasetDAO,
    dataStoreService: DataStoreService,
    tracingStoreService: TracingStoreService,
    tracingStoreDAO: TracingStoreDAO,
    taskDAO: TaskDAO,
    teamDAO: TeamDAO,
    userService: UserService,
    teamService: TeamService,
    dataStoreDAO: DataStoreDAO,
    projectDAO: ProjectDAO,
    organizationDAO: OrganizationDAO,
    annotationRestrictionDefaults: AnnotationRestrictionDefaults,
    nmlWriter: NmlWriter,
    temporaryFileCreator: TemporaryFileCreator,
    conf: WkConf,
    rpc: RPC
)(implicit ec: ExecutionContext, val materializer: Materializer)
    extends BoxImplicits
    with FoxImplicits
    with ProtoGeometryImplicits
    with LazyLogging {
  implicit val actorSystem: ActorSystem = ActorSystem()

  val DefaultAnnotationListLimit = 1000

  private def selectSuitableTeam(user: User, dataset: Dataset): Fox[ObjectId] =
    (for {
      userTeamIds <- userService.teamIdsFor(user._id)
      datasetAllowedTeamIds <- teamService.allowedTeamIdsForDataset(dataset, cumulative = true) ?~> "allowedTeams.notFound"
    } yield {
      val selectedTeamOpt = datasetAllowedTeamIds.intersect(userTeamIds).headOption
      selectedTeamOpt match {
        case Some(selectedTeam) => Fox.successful(selectedTeam)
        case None =>
          for {
            isTeamManagerOrAdminOfOrg <- userService.isTeamManagerOrAdminOfOrg(user, user._organization)
            _ <- bool2Fox(isTeamManagerOrAdminOfOrg || dataset.isPublic || user.isDatasetManager)
            organizationTeamId <- organizationDAO.findOrganizationTeamId(user._organization)
          } yield organizationTeamId
      }
    }).flatten

  private def createVolumeTracing(
      dataSource: DataSource,
      datasetOrganizationId: String,
      datasetDataStore: DataStore,
      fallbackLayer: Option[SegmentationLayer],
      boundingBox: Option[BoundingBox] = None,
      startPosition: Option[Vec3Int] = None,
      startRotation: Option[Vec3Double] = None,
      magRestrictions: MagRestrictions,
      mappingName: Option[String]
  ): Fox[VolumeTracing] = {
    val mags = VolumeTracingDownsampling.magsForVolumeTracing(dataSource, fallbackLayer)
    val magsRestricted = magRestrictions.filterAllowed(mags)
    val additionalAxes =
      fallbackLayer.map(_.additionalAxes).getOrElse(dataSource.additionalAxesUnion)
    for {
      _ <- bool2Fox(magsRestricted.nonEmpty) ?~> "annotation.volume.magRestrictionsTooTight"
      remoteDatastoreClient = new WKRemoteDataStoreClient(datasetDataStore, rpc)
      fallbackLayerHasSegmentIndex <- fallbackLayer match {
        case Some(layer) =>
          remoteDatastoreClient.hasSegmentIndexFile(datasetOrganizationId, dataSource.id.directoryName, layer.name)
        case None => Fox.successful(false)
      }
    } yield
      VolumeTracing(
        None,
        boundingBoxToProto(boundingBox.getOrElse(dataSource.boundingBox)),
        System.currentTimeMillis(),
        dataSource.id.directoryName,
        vec3IntToProto(startPosition.getOrElse(dataSource.center)),
        vec3DoubleToProto(startRotation.getOrElse(vec3DoubleFromProto(VolumeTracingDefaults.editRotation))),
        elementClassToProto(
          fallbackLayer.map(layer => layer.elementClass).getOrElse(VolumeTracingDefaults.elementClass)),
        fallbackLayer.map(_.name),
        combineLargestSegmentIdsByPrecedence(fromNml = None, fromFallbackLayer = fallbackLayer.map(_.largestSegmentId)),
        0,
        VolumeTracingDefaults.zoomLevel,
        organizationId = Some(datasetOrganizationId),
        mappingName = mappingName,
        mags = magsRestricted.map(vec3IntToProto),
        hasSegmentIndex = Some(fallbackLayer.isEmpty || fallbackLayerHasSegmentIndex),
        additionalAxes = AdditionalAxis.toProto(additionalAxes),
        volumeBucketDataHasChanged = Some(false)
      )
  }

  def combineLargestSegmentIdsByPrecedence(fromNml: Option[Long],
                                           fromFallbackLayer: Option[Option[Long]]): Option[Long] =
    if (fromNml.nonEmpty)
      // This was called for an NML upload. The NML had an explicit largestSegmentId. Use that.
      fromNml
    else if (fromFallbackLayer.nonEmpty)
      // There is a fallback layer. Use its largestSegmentId, even if it is None.
      // Some tracing functionality will be disabled until a segment id is set by the user.
      fromFallbackLayer.flatten
    else {
      // There is no fallback layer. Start at default segment id for fresh volume layers
      VolumeTracingDefaults.largestSegmentId
    }

  def addAnnotationLayer(annotation: Annotation,
                         organizationId: String,
                         annotationLayerParameters: AnnotationLayerParameters)(implicit ctx: DBAccessContext,
                                                                               mp: MessagesProvider): Fox[Unit] =
    for {
      dataset <- datasetDAO.findOne(annotation._dataset) ?~> "dataset.notFoundForAnnotation"
      dataSource <- datasetService.dataSourceFor(dataset).flatMap(_.toUsable) ?~> "dataSource.notFound"
      newAnnotationLayers <- createTracingsForExplorational(
        dataset,
        dataSource,
        List(annotationLayerParameters),
        organizationId,
        annotation.annotationLayers) ?~> "annotation.createTracings.failed"
      _ <- annotationLayersDAO.insertForAnnotation(annotation._id, newAnnotationLayers)
    } yield ()

  def deleteAnnotationLayer(annotation: Annotation, layerName: String): Fox[Unit] =
    for {
      _ <- annotationLayersDAO.deleteOne(annotation._id, layerName)
    } yield ()

  private def createTracingsForExplorational(dataset: Dataset,
                                             dataSource: DataSource,
                                             allAnnotationLayerParameters: List[AnnotationLayerParameters],
                                             datasetOrganizationId: String,
                                             existingAnnotationLayers: List[AnnotationLayer] = List())(
      implicit ctx: DBAccessContext,
      mp: MessagesProvider): Fox[List[AnnotationLayer]] = {

    def getAutoFallbackLayerName: Option[String] =
      dataSource.dataLayers.find {
        case _: SegmentationLayer => true
        case _                    => false
      }.map(_.name)

    def getFallbackLayer(fallbackLayerName: String): Fox[SegmentationLayer] =
      for {
        fallbackLayer <- dataSource.dataLayers
          .filter(dl => dl.name == fallbackLayerName)
          .flatMap {
            case layer: SegmentationLayer => Some(layer)
            case _                        => None
          }
          .headOption
          .toFox
        _ <- bool2Fox(
          ElementClass
            .largestSegmentIdIsInRange(fallbackLayer.largestSegmentId, fallbackLayer.elementClass)) ?~> Messages(
          "annotation.volume.largestSegmentIdExceedsRange",
          fallbackLayer.largestSegmentId,
          fallbackLayer.elementClass)
      } yield fallbackLayer

    def createAndSaveAnnotationLayer(annotationLayerParameters: AnnotationLayerParameters,
                                     oldPrecedenceLayerProperties: Option[RedundantTracingProperties],
                                     dataStore: DataStore): Fox[AnnotationLayer] =
      for {
        client <- tracingStoreService.clientFor(dataset)
        tracingIdAndName <- annotationLayerParameters.typ match {
          case AnnotationLayerType.Skeleton =>
            val skeleton = SkeletonTracingDefaults.createInstance.copy(
              datasetName = dataset.name,
              editPosition = dataSource.center,
              organizationId = Some(datasetOrganizationId),
              additionalAxes = AdditionalAxis.toProto(dataSource.additionalAxesUnion)
            )
            val skeletonAdapted = oldPrecedenceLayerProperties.map { p =>
              skeleton.copy(
                editPosition = p.editPosition,
                editRotation = p.editRotation,
                zoomLevel = p.zoomLevel,
                userBoundingBoxes = p.userBoundingBoxes,
                editPositionAdditionalCoordinates = p.editPositionAdditionalCoordinates
              )
            }.getOrElse(skeleton)
            for {
              tracingId <- client.saveSkeletonTracing(skeletonAdapted)
              name = annotationLayerParameters.name.getOrElse(
                AnnotationLayer.defaultNameForType(annotationLayerParameters.typ))
            } yield (tracingId, name)
          case AnnotationLayerType.Volume =>
            val autoFallbackLayerName =
              if (annotationLayerParameters.autoFallbackLayer) getAutoFallbackLayerName else None
            val fallbackLayerName = annotationLayerParameters.fallbackLayerName.orElse(autoFallbackLayerName)
            for {
              fallbackLayer <- Fox.runOptional(fallbackLayerName)(getFallbackLayer)
              volumeTracing <- createVolumeTracing(
                dataSource,
                datasetOrganizationId,
                dataStore,
                fallbackLayer,
                magRestrictions = annotationLayerParameters.magRestrictions.getOrElse(MagRestrictions.empty),
                mappingName = annotationLayerParameters.mappingName,
              )
              volumeTracingAdapted = oldPrecedenceLayerProperties.map { p =>
                volumeTracing.copy(
                  editPosition = p.editPosition,
                  editRotation = p.editRotation,
                  zoomLevel = p.zoomLevel,
                  userBoundingBoxes = p.userBoundingBoxes,
                  editPositionAdditionalCoordinates = p.editPositionAdditionalCoordinates
                )
              }.getOrElse(volumeTracing)
              volumeTracingId <- client.saveVolumeTracing(volumeTracingAdapted, dataSource = Some(dataSource))
              name = annotationLayerParameters.name
                .orElse(autoFallbackLayerName)
                .getOrElse(AnnotationLayer.defaultNameForType(annotationLayerParameters.typ))
            } yield (volumeTracingId, name)
          case _ =>
            Fox.failure(s"Unknown AnnotationLayerType: ${annotationLayerParameters.typ}")
        }
      } yield
        AnnotationLayer(tracingIdAndName._1,
                        annotationLayerParameters.typ,
                        tracingIdAndName._2,
                        AnnotationLayerStatistics.zeroedForTyp(annotationLayerParameters.typ))

    def fetchOldPrecedenceLayer: Fox[Option[FetchedAnnotationLayer]] =
      if (existingAnnotationLayers.isEmpty) Fox.successful(None)
      else
        for {
          oldPrecedenceLayer <- selectLayerWithPrecedence(existingAnnotationLayers)
          tracingStoreClient <- tracingStoreService.clientFor(dataset)
          oldPrecedenceLayerFetched <- if (oldPrecedenceLayer.typ == AnnotationLayerType.Skeleton)
            tracingStoreClient.getSkeletonTracing(oldPrecedenceLayer, None)
          else
            tracingStoreClient.getVolumeTracing(oldPrecedenceLayer,
                                                None,
                                                skipVolumeData = true,
                                                volumeDataZipFormat = VolumeDataZipFormat.wkw,
                                                dataset.voxelSize)
        } yield Some(oldPrecedenceLayerFetched)

    def extractPrecedenceProperties(oldPrecedenceLayer: FetchedAnnotationLayer): RedundantTracingProperties =
      oldPrecedenceLayer.tracing match {
        case Left(s) =>
          RedundantTracingProperties(
            s.editPosition,
            s.editRotation,
            s.zoomLevel,
            s.userBoundingBoxes ++ s.userBoundingBox.map(
              com.scalableminds.webknossos.datastore.geometry.NamedBoundingBoxProto(0, None, None, None, _)),
            s.editPositionAdditionalCoordinates
          )
        case Right(v) =>
          RedundantTracingProperties(
            v.editPosition,
            v.editRotation,
            v.zoomLevel,
            v.userBoundingBoxes ++ v.userBoundingBox.map(
              com.scalableminds.webknossos.datastore.geometry.NamedBoundingBoxProto(0, None, None, None, _)),
            v.editPositionAdditionalCoordinates
          )
      }

    for {
      /*
        Note that the tracings have redundant properties, with a precedence logic selecting a layer
        from which the values are used. Adding a layer may change this precedence, so the redundant
        values need to be copied to the new layer from the layer that had precedence before. Otherwise, those
        properties would be masked and lost.
        Unfortunately, their history is still lost since the new layer gets only the latest snapshot.
        We do this for *every* new layer, since we only later get its ID which determines the actual precedence.
        All of this is skipped if existingAnnotationLayers is empty.
       */
      oldPrecedenceLayer <- fetchOldPrecedenceLayer
      dataStore <- dataStoreDAO.findOneByName(dataset._dataStore.trim) ?~> "dataStore.notFoundForDataset"
      precedenceProperties = oldPrecedenceLayer.map(extractPrecedenceProperties)
      newAnnotationLayers <- Fox.serialCombined(allAnnotationLayerParameters)(p =>
        createAndSaveAnnotationLayer(p, precedenceProperties, dataStore))
    } yield newAnnotationLayers
  }

  /*
   If there is more than one tracing, select the one that has precedence for the parameters (they should be identical anyway)
   This needs to match the code in NmlWriter’s selectLayerWithPrecedence, though the types are different
   */
  private def selectLayerWithPrecedence(annotationLayers: List[AnnotationLayer]): Fox[AnnotationLayer] = {
    val skeletonLayers = annotationLayers.filter(_.typ == AnnotationLayerType.Skeleton)
    val volumeLayers = annotationLayers.filter(_.typ == AnnotationLayerType.Volume)
    if (skeletonLayers.nonEmpty) {
      Fox.successful(skeletonLayers.minBy(_.tracingId))
    } else if (volumeLayers.nonEmpty) {
      Fox.successful(volumeLayers.minBy(_.tracingId))
    } else Fox.failure("Trying to select precedence layer from empty layer list.")
  }

  def createExplorationalFor(user: User,
                             datasetId: ObjectId,
                             annotationLayerParameters: List[AnnotationLayerParameters])(
      implicit ctx: DBAccessContext,
      m: MessagesProvider): Fox[Annotation] =
    for {
      dataset <- datasetDAO.findOne(datasetId) ?~> "dataset.noAccessById"
      dataSource <- datasetService.dataSourceFor(dataset)
      datasetOrganization <- organizationDAO.findOne(dataset._organization)(GlobalAccessContext) ?~> "organization.notFound"
      usableDataSource <- dataSource.toUsable ?~> Messages("dataset.notImported", dataSource.id.directoryName)
      annotationLayers <- createTracingsForExplorational(dataset,
                                                         usableDataSource,
                                                         annotationLayerParameters,
                                                         datasetOrganization._id) ?~> "annotation.createTracings.failed"
      teamId <- selectSuitableTeam(user, dataset) ?~> "annotation.create.forbidden"
      annotation = Annotation(ObjectId.generate, datasetId, None, teamId, user._id, annotationLayers)
      _ <- annotationDAO.insertOne(annotation)
    } yield annotation

  def makeAnnotationHybrid(annotation: Annotation, organizationId: String, fallbackLayerName: Option[String])(
      implicit ctx: DBAccessContext,
      mp: MessagesProvider): Fox[Unit] =
    for {
      newAnnotationLayerType <- annotation.tracingType match {
        case TracingType.skeleton => Fox.successful(AnnotationLayerType.Volume)
        case TracingType.volume   => Fox.successful(AnnotationLayerType.Skeleton)
        case _                    => Fox.failure("annotation.makeHybrid.alreadyHybrid")
      }
      usedFallbackLayerName = if (newAnnotationLayerType == AnnotationLayerType.Volume) fallbackLayerName else None
      newAnnotationLayerParameters = AnnotationLayerParameters(
        newAnnotationLayerType,
        usedFallbackLayerName,
        autoFallbackLayer = false,
        None,
        Some(MagRestrictions.empty),
        Some(AnnotationLayer.defaultNameForType(newAnnotationLayerType)),
        None
      )
      _ <- addAnnotationLayer(annotation, organizationId, newAnnotationLayerParameters) ?~> "makeHybrid.createTracings.failed"
    } yield ()

  def downsampleAnnotation(annotation: Annotation, volumeAnnotationLayer: AnnotationLayer)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      dataset <- datasetDAO.findOne(annotation._dataset) ?~> "dataset.notFoundForAnnotation"
      _ <- bool2Fox(volumeAnnotationLayer.typ == AnnotationLayerType.Volume) ?~> "annotation.downsample.volumeOnly"
      rpcClient <- tracingStoreService.clientFor(dataset)
      newVolumeTracingId <- rpcClient.duplicateVolumeTracing(volumeAnnotationLayer.tracingId, downsample = true)
      _ = logger.info(
        s"Replacing volume tracing ${volumeAnnotationLayer.tracingId} by downsampled copy $newVolumeTracingId for annotation ${annotation._id}.")
      _ <- annotationLayersDAO.replaceTracingId(annotation._id, volumeAnnotationLayer.tracingId, newVolumeTracingId)
    } yield ()

  // WARNING: needs to be repeatable, might be called multiple times for an annotation
  def finish(annotation: Annotation, user: User, restrictions: AnnotationRestrictions)(
      implicit ctx: DBAccessContext): Fox[String] = {
    def executeFinish: Fox[String] =
      for {
        _ <- annotationDAO.updateModified(annotation._id, Instant.now)
        _ <- annotationDAO.updateState(annotation._id, AnnotationState.Finished)
      } yield {
        if (annotation._task.isEmpty)
          "annotation.finished"
        else
          "task.finished"
      }

    (for {
      allowed <- restrictions.allowFinishSoft(user)
    } yield {
      if (allowed) {
        if (annotation.state == Active) {
          logger.info(
            s"Finishing annotation ${annotation._id.toString}, new state will be ${AnnotationState.Finished.toString}, access context: ${ctx.toStringAnonymous}")
          executeFinish
        } else if (annotation.state == Finished) {
          logger.info(
            s"Silently not finishing annotation ${annotation._id.toString} for it is already finished. Access context: ${ctx.toStringAnonymous}")
          Fox.successful("annotation.finished")
        } else {
          logger.info(
            s"Not finishing annotation ${annotation._id.toString} for its state is ${annotation.state.toString}. Access context: ${ctx.toStringAnonymous}")
          Fox.failure("annotation.notActive")
        }
      } else {
        logger.info(
          s"Not finishing annotation ${annotation._id.toString} due to missing permissions. Access context: ${ctx.toStringAnonymous}")
        Fox.failure("annotation.notPossible")
      }
    }).flatten
  }

  private def baseForTask(taskId: ObjectId)(implicit ctx: DBAccessContext): Fox[Annotation] =
    (for {
      list <- annotationDAO.findAllByTaskIdAndType(taskId, AnnotationType.TracingBase)
    } yield list.headOption.toFox).flatten

  def annotationsFor(taskId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[Annotation]] =
    annotationDAO.findAllByTaskIdAndType(taskId, AnnotationType.Task)

  private def tracingsFromBase(annotationBase: Annotation, dataset: Dataset)(
      implicit ctx: DBAccessContext,
      m: MessagesProvider): Fox[(Option[String], Option[String])] =
    for {
      _ <- bool2Fox(dataset.isUsable) ?~> Messages("dataset.notImported", dataset.name)
      tracingStoreClient <- tracingStoreService.clientFor(dataset)
      baseSkeletonIdOpt <- annotationBase.skeletonTracingId
      baseVolumeIdOpt <- annotationBase.volumeTracingId
      newSkeletonId: Option[String] <- Fox.runOptional(baseSkeletonIdOpt)(skeletonId =>
        tracingStoreClient.duplicateSkeletonTracing(skeletonId))
      newVolumeId: Option[String] <- Fox.runOptional(baseVolumeIdOpt)(volumeId =>
        tracingStoreClient.duplicateVolumeTracing(volumeId))
    } yield (newSkeletonId, newVolumeId)

  def createAnnotationFor(user: User, taskId: ObjectId, initializingAnnotationId: ObjectId)(
      implicit m: MessagesProvider,
      ctx: DBAccessContext): Fox[Annotation] = {
    def useAsTemplateAndInsert(annotation: Annotation) =
      for {
        datasetName <- datasetDAO.getNameById(annotation._dataset)(GlobalAccessContext) ?~> "dataset.notFoundForAnnotation"
        dataset <- datasetDAO.findOne(annotation._dataset) ?~> Messages("dataset.noAccess", datasetName)
        (newSkeletonId, newVolumeId) <- tracingsFromBase(annotation, dataset) ?~> s"Failed to use annotation base as template for task $taskId with annotation base ${annotation._id}"
        annotationLayers <- AnnotationLayer.layersFromIds(newSkeletonId, newVolumeId)
        newAnnotation = annotation.copy(
          _id = initializingAnnotationId,
          _user = user._id,
          annotationLayers = annotationLayers,
          state = Active,
          typ = AnnotationType.Task,
          created = Instant.now,
          modified = Instant.now
        )
        _ <- annotationDAO.updateInitialized(newAnnotation)
      } yield newAnnotation

    for {
      annotationBase <- baseForTask(taskId) ?~> "Failed to retrieve annotation base."
      result <- useAsTemplateAndInsert(annotationBase).toFox
    } yield result
  }

  def createSkeletonTracingBase(datasetId: ObjectId,
                                boundingBox: Option[BoundingBox],
                                startPosition: Vec3Int,
                                startRotation: Vec3Double)(implicit ctx: DBAccessContext): Fox[SkeletonTracing] = {
    val initialNode = NodeDefaults.createInstance.withId(1).withPosition(startPosition).withRotation(startRotation)
    val initialTree = Tree(
      1,
      Seq(initialNode),
      Seq.empty,
      Some(ColorProto(1, 0, 0, 1)),
      Seq(BranchPoint(initialNode.id, System.currentTimeMillis())),
      Seq.empty,
      "",
      System.currentTimeMillis()
    )
    for {
      dataset <- datasetDAO.findOne(datasetId)
    } yield
      SkeletonTracingDefaults.createInstance.copy(
        datasetName = dataset.name,
        boundingBox = boundingBox.flatMap { box =>
          if (box.isEmpty) None else Some(box)
        },
        editPosition = startPosition,
        editRotation = startRotation,
        activeNodeId = Some(1),
        trees = Seq(initialTree)
      )
  }

  def createVolumeTracingBase(
      datasetId: ObjectId,
      boundingBox: Option[BoundingBox],
      startPosition: Vec3Int,
      startRotation: Vec3Double,
      volumeShowFallbackLayer: Boolean,
      magRestrictions: MagRestrictions)(implicit ctx: DBAccessContext, m: MessagesProvider): Fox[VolumeTracing] =
    for {
      dataset <- datasetDAO.findOne(datasetId) ?~> Messages("dataset.notFound", datasetId)
      dataSource <- datasetService.dataSourceFor(dataset).flatMap(_.toUsable)
      dataStore <- dataStoreDAO.findOneByName(dataset._dataStore.trim)
      fallbackLayer = if (volumeShowFallbackLayer) {
        dataSource.dataLayers.flatMap {
          case layer: SegmentationLayer => Some(layer)
          case _                        => None
        }.headOption
      } else None
      _ <- bool2Fox(fallbackLayer.forall(_.largestSegmentId.exists(_ >= 0L))) ?~> "annotation.volume.invalidLargestSegmentId"

      volumeTracing <- createVolumeTracing(
        dataSource,
        dataset._organization,
        dataStore,
        fallbackLayer = fallbackLayer,
        boundingBox = boundingBox.flatMap { box =>
          if (box.isEmpty) None else Some(box)
        },
        startPosition = Some(startPosition),
        startRotation = Some(startRotation),
        magRestrictions = magRestrictions,
        mappingName = None
      )
    } yield volumeTracing

  def abortInitializedAnnotationOnFailure(initializingAnnotationId: ObjectId,
                                          insertedAnnotationBox: Box[Annotation]): Fox[Unit] =
    insertedAnnotationBox match {
      case Full(_) => Fox.successful(())
      case _       => annotationDAO.abortInitializingAnnotation(initializingAnnotationId)
    }

  def createAnnotationBase(
      taskFox: Fox[Task],
      userId: ObjectId,
      skeletonTracingIdBox: Box[Option[String]],
      volumeTracingIdBox: Box[Option[String]],
      datasetId: ObjectId,
      description: Option[String]
  )(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      task <- taskFox
      skeletonIdOpt <- skeletonTracingIdBox.toFox
      volumeIdOpt <- volumeTracingIdBox.toFox
      _ <- bool2Fox(skeletonIdOpt.isDefined || volumeIdOpt.isDefined) ?~> "annotation.needsAtleastOne"
      project <- projectDAO.findOne(task._project)
      annotationLayers <- AnnotationLayer.layersFromIds(skeletonIdOpt, volumeIdOpt)
      annotationBase = Annotation(ObjectId.generate,
                                  datasetId,
                                  Some(task._id),
                                  project._team,
                                  userId,
                                  annotationLayers,
                                  description.getOrElse(""),
                                  typ = AnnotationType.TracingBase)
      _ <- annotationDAO.insertOne(annotationBase)
    } yield ()

  def createFrom(user: User,
                 dataset: Dataset,
                 annotationLayers: List[AnnotationLayer],
                 annotationType: AnnotationType,
                 name: Option[String],
                 description: String): Fox[Annotation] =
    for {
      teamId <- selectSuitableTeam(user, dataset)
      annotation = Annotation(ObjectId.generate,
                              dataset._id,
                              None,
                              teamId,
                              user._id,
                              annotationLayers,
                              description,
                              name = name.getOrElse(""),
                              typ = annotationType)
      _ <- annotationDAO.insertOne(annotation)
    } yield annotation

  def updateTeamsForSharedAnnotation(annotationId: ObjectId, teams: List[ObjectId])(
      implicit ctx: DBAccessContext): Fox[Unit] =
    annotationDAO.updateTeamsForSharedAnnotation(annotationId, teams)

  def zipAnnotations(annotations: List[Annotation],
                     zipFileName: String,
                     skipVolumeData: Boolean,
                     volumeDataZipFormat: VolumeDataZipFormat)(implicit
                                                               ctx: DBAccessContext): Fox[TemporaryFile] =
    for {
      downloadAnnotations <- getTracingsScalesAndNamesFor(annotations, skipVolumeData, volumeDataZipFormat)
      nmlsAndVolumes <- Fox.serialCombined(downloadAnnotations.flatten) {
        case DownloadAnnotation(skeletonTracingIdOpt,
                                volumeTracingIdOpt,
                                skeletonTracingOpt,
                                volumeTracingOpt,
                                volumeDataOpt,
                                name,
                                voxelSizeOpt,
                                annotation,
                                user,
                                taskOpt,
                                organizationId,
                                datasetName,
                                datasetId) =>
          for {
            fetchedAnnotationLayersForAnnotation <- FetchedAnnotationLayer.layersFromTracings(skeletonTracingIdOpt,
                                                                                              volumeTracingIdOpt,
                                                                                              skeletonTracingOpt,
                                                                                              volumeTracingOpt)
            nml = nmlWriter.toNmlStream(
              name,
              fetchedAnnotationLayersForAnnotation,
              Some(annotation),
              voxelSizeOpt,
              Some(name + "_data.zip"),
              organizationId,
              conf.Http.uri,
              datasetName,
              datasetId,
              Some(user),
              taskOpt,
              skipVolumeData,
              volumeDataZipFormat
            )
          } yield (nml, volumeDataOpt)
      }
      zip <- createZip(nmlsAndVolumes, zipFileName)
    } yield zip

  private def getTracingsScalesAndNamesFor(
      annotations: List[Annotation],
      skipVolumeData: Boolean,
      volumeDataZipFormat: VolumeDataZipFormat)(implicit ctx: DBAccessContext): Fox[List[List[DownloadAnnotation]]] = {

    def getSingleDownloadAnnotation(annotation: Annotation, voxelSizeOpt: Option[VoxelSize]) =
      for {
        user <- userService.findOneCached(annotation._user) ?~> "user.notFound"
        taskOpt <- Fox.runOptional(annotation._task)(taskDAO.findOne) ?~> "task.notFound"
        name <- savedTracingInformationHandler.nameForAnnotation(annotation)
        dataset <- datasetDAO.findOne(annotation._dataset)
        organizationId <- organizationDAO.findOrganizationIdForAnnotation(annotation._id)
        skeletonTracingIdOpt <- annotation.skeletonTracingId
        volumeTracingIdOpt <- annotation.volumeTracingId
      } yield
        DownloadAnnotation(skeletonTracingIdOpt,
                           volumeTracingIdOpt,
                           None,
                           None,
                           None,
                           name,
                           voxelSizeOpt,
                           annotation,
                           user,
                           taskOpt,
                           organizationId,
                           dataset.name,
                           dataset._id)

    def getSkeletonTracings(datasetId: ObjectId, tracingIds: List[Option[String]]): Fox[List[Option[SkeletonTracing]]] =
      for {
        dataset <- datasetDAO.findOne(datasetId)
        tracingStoreClient <- tracingStoreService.clientFor(dataset)
        tracingContainers: List[SkeletonTracings] <- Fox.serialCombined(tracingIds.grouped(1000).toList)(
          tracingStoreClient.getSkeletonTracings)
        tracingOpts: List[SkeletonTracingOpt] = tracingContainers.flatMap(_.tracings)
      } yield tracingOpts.map(_.tracing)

    def getVolumeTracings(datasetId: ObjectId, tracingIds: List[Option[String]]): Fox[List[Option[VolumeTracing]]] =
      for {
        dataset <- datasetDAO.findOne(datasetId)
        tracingStoreClient <- tracingStoreService.clientFor(dataset)
        tracingContainers: List[VolumeTracings] <- Fox.serialCombined(tracingIds.grouped(1000).toList)(
          tracingStoreClient.getVolumeTracings)
        tracingOpts: List[VolumeTracingOpt] = tracingContainers.flatMap(_.tracings)
      } yield tracingOpts.map(_.tracing)

    def getVolumeDataObjects(datasetId: ObjectId,
                             tracingIds: List[Option[String]],
                             volumeDataZipFormat: VolumeDataZipFormat): Fox[List[Option[Array[Byte]]]] =
      for {
        dataset <- datasetDAO.findOne(datasetId)
        tracingStoreClient <- tracingStoreService.clientFor(dataset)
        tracingDataObjects: List[Option[Array[Byte]]] <- Fox.serialCombined(tracingIds) {
          case None                      => Fox.successful(None)
          case Some(_) if skipVolumeData => Fox.successful(None)
          case Some(tracingId) =>
            tracingStoreClient
              .getVolumeData(tracingId,
                             version = None,
                             volumeDataZipFormat = volumeDataZipFormat,
                             voxelSize = dataset.voxelSize)
              .map(Some(_))
        }
      } yield tracingDataObjects

    def getDatasetScale(datasetId: ObjectId) =
      for {
        dataset <- datasetDAO.findOne(datasetId)
      } yield dataset.voxelSize

    val annotationsGrouped: Map[ObjectId, List[Annotation]] = annotations.groupBy(_._dataset)
    val tracingsGrouped = annotationsGrouped.map {
      case (datasetId, annotations) =>
        for {
          scale <- getDatasetScale(datasetId)
          skeletonTracingIdOpts <- Fox.serialCombined(annotations)(a => a.skeletonTracingId)
          volumeTracingIdOpts <- Fox.serialCombined(annotations)(a => a.volumeTracingId)
          skeletonTracings <- getSkeletonTracings(datasetId, skeletonTracingIdOpts)
          volumeTracings <- getVolumeTracings(datasetId, volumeTracingIdOpts)
          volumeDataObjects <- getVolumeDataObjects(datasetId, volumeTracingIdOpts, volumeDataZipFormat)
          incompleteDownloadAnnotations <- Fox.serialCombined(annotations)(getSingleDownloadAnnotation(_, scale))
        } yield
          incompleteDownloadAnnotations
            .zip(skeletonTracings)
            .map {
              case (downloadAnnotation, skeletonTracingOpt) =>
                downloadAnnotation.copy(skeletonTracingOpt = skeletonTracingOpt)
            }
            .zip(volumeTracings)
            .map {
              case (downloadAnnotation, volumeTracingOpt) =>
                downloadAnnotation.copy(volumeTracingOpt = volumeTracingOpt)
            }
            .zip(volumeDataObjects)
            .map {
              case (downloadAnnotation, volumeDataOpt) =>
                downloadAnnotation.copy(volumeDataOpt = volumeDataOpt)
            }
    }

    Fox.combined(tracingsGrouped.toList)
  }

  private def createZip(nmls: List[(NamedStream, Option[Array[Byte]])], zipFileName: String): Fox[TemporaryFile] = {
    val zipped = temporaryFileCreator.create(TextUtils.normalize(zipFileName), ".zip")
    val zipper = ZipIO.startZip(new BufferedOutputStream(new FileOutputStream(new File(zipped.path.toString))))

    def addToZip(nmls: List[(NamedStream, Option[Array[Byte]])]): Fox[Boolean] =
      nmls match {
        case (nml, volumeDataOpt) :: tail =>
          if (volumeDataOpt.isDefined) {
            val subZip = temporaryFileCreator.create(TextUtils.normalize(nml.name), ".zip")
            val subZipper =
              ZipIO.startZip(new BufferedOutputStream(new FileOutputStream(new File(subZip.path.toString))))
            volumeDataOpt.foreach(volumeData => subZipper.addFileFromBytes(nml.name + "_data.zip", volumeData))
            for {
              _ <- subZipper.addFileFromNamedStream(nml, suffix = ".nml")
              _ = subZipper.close()
              _ = zipper.addFileFromTemporaryFile(nml.name + ".zip", subZip)
              res <- addToZip(tail)
            } yield res
          } else {
            zipper.addFileFromNamedStream(nml, suffix = ".nml").flatMap(_ => addToZip(tail))
          }
        case _ =>
          Future.successful(true)
      }

    addToZip(nmls).map { _ =>
      zipper.close()
      zipped
    }
  }

  def transferAnnotationToUser(typ: String, id: ObjectId, userId: ObjectId, issuingUser: User)(
      implicit ctx: DBAccessContext): Fox[Annotation] =
    for {
      annotation <- annotationInformationProvider.provideAnnotation(typ, id, issuingUser) ?~> "annotation.notFound"
      newUser <- userDAO.findOne(userId) ?~> "user.notFound"
      _ <- datasetDAO.findOne(annotation._dataset)(AuthorizedAccessContext(newUser)) ?~> "annotation.transferee.noDatasetAccess"
      _ <- annotationDAO.updateUser(annotation._id, newUser._id)
      updated <- annotationInformationProvider.provideAnnotation(typ, id, issuingUser)
    } yield updated

  def resetToBase(annotation: Annotation)(implicit ctx: DBAccessContext, m: MessagesProvider): Fox[Unit] =
    annotation.typ match {
      case AnnotationType.Explorational =>
        Fox.failure("annotation.revert.tasksOnly")
      case AnnotationType.Task =>
        for {
          task <- taskFor(annotation)
          oldSkeletonTracingIdOpt <- annotation.skeletonTracingId // This also asserts that the annotation does not have multiple volume/skeleton layers
          oldVolumeTracingIdOpt <- annotation.volumeTracingId
          _ = logger.warn(
            s"Resetting annotation ${annotation._id} to base, discarding skeleton tracing $oldSkeletonTracingIdOpt and/or volume tracing $oldVolumeTracingIdOpt")
          annotationBase <- baseForTask(task._id)
          dataset <- datasetDAO.findOne(annotationBase._dataset)(GlobalAccessContext) ?~> "dataset.notFoundForAnnotation"
          (newSkeletonIdOpt, newVolumeIdOpt) <- tracingsFromBase(annotationBase, dataset)
          _ <- Fox.bool2Fox(newSkeletonIdOpt.isDefined || newVolumeIdOpt.isDefined) ?~> "annotation.needsEitherSkeletonOrVolume"
          _ <- Fox.runOptional(newSkeletonIdOpt)(newSkeletonId =>
            oldSkeletonTracingIdOpt.toFox.map { oldSkeletonId =>
              annotationLayersDAO.replaceTracingId(annotation._id, oldSkeletonId, newSkeletonId)
          })
          _ <- Fox.runOptional(newVolumeIdOpt)(newVolumeId =>
            oldVolumeTracingIdOpt.toFox.map { oldVolumeId =>
              annotationLayersDAO.replaceTracingId(annotation._id, oldVolumeId, newVolumeId)
          })
        } yield ()
    }

  private def settingsFor(annotation: Annotation)(implicit ctx: DBAccessContext) =
    if (annotation.typ == AnnotationType.Task || annotation.typ == AnnotationType.TracingBase)
      for {
        taskId <- annotation._task.toFox
        task: Task <- taskDAO.findOne(taskId) ?~> "task.notFound"
        taskType <- taskTypeDAO.findOne(task._taskType) ?~> "taskType.notFound"
      } yield {
        taskType.settings
      } else
      Fox.successful(AnnotationSettings.defaultFor(annotation.tracingType))

  def taskFor(annotation: Annotation)(implicit ctx: DBAccessContext): Fox[Task] =
    annotation._task.toFox.flatMap(taskId => taskDAO.findOne(taskId))

  def publicWrites(annotation: Annotation,
                   requestingUser: Option[User] = None,
                   restrictionsOpt: Option[AnnotationRestrictions] = None): Fox[JsObject] = {
    implicit val ctx: DBAccessContext = GlobalAccessContext
    for {
      dataset <- datasetDAO.findOne(annotation._dataset) ?~> "dataset.notFoundForAnnotation"
      organization <- organizationDAO.findOne(dataset._organization) ?~> "organization.notFound"
      task = annotation._task.toFox.flatMap(taskId => taskDAO.findOne(taskId))
      taskJson <- task.flatMap(t => taskService.publicWrites(t)).getOrElse(JsNull)
      userJson <- userJsonForAnnotation(annotation._user)
      settings <- settingsFor(annotation)
      restrictionsJs <- AnnotationRestrictions.writeAsJson(
        restrictionsOpt.getOrElse(annotationRestrictionDefaults.defaultsFor(annotation)),
        requestingUser)
      dataStore <- dataStoreDAO.findOneByName(dataset._dataStore.trim) ?~> "datastore.notFound"
      dataStoreJs <- dataStoreService.publicWrites(dataStore)
      teams <- teamDAO.findSharedTeamsForAnnotation(annotation._id)
      teamsJson <- Fox.serialCombined(teams)(teamService.publicWrites(_))
      tracingStore <- tracingStoreDAO.findFirst
      tracingStoreJs <- tracingStoreService.publicWrites(tracingStore)
      contributors <- userDAO.findContributorsForAnnotation(annotation._id)
      contributorsJs <- Fox.serialCombined(contributors)(c => userJsonForAnnotation(c._id, Some(c)))
    } yield {
      Json.obj(
        "modified" -> annotation.modified,
        "state" -> annotation.state,
        "isLockedByOwner" -> annotation.isLockedByOwner,
        "id" -> annotation.id,
        "name" -> annotation.name,
        "description" -> annotation.description,
        "viewConfiguration" -> annotation.viewConfiguration,
        "typ" -> annotation.typ,
        "task" -> taskJson,
        "stats" -> Json.obj(), // included for legacy parsers
        "restrictions" -> restrictionsJs,
        "annotationLayers" -> Json.toJson(annotation.annotationLayers),
        "datasetId" -> dataset._id,
        "dataSetName" -> dataset.name,
        "organization" -> organization._id,
        "dataStore" -> dataStoreJs,
        "tracingStore" -> tracingStoreJs,
        "visibility" -> annotation.visibility,
        "settings" -> settings,
        "tracingTime" -> annotation.tracingTime,
        "teams" -> teamsJson,
        "tags" -> (annotation.tags ++ Set(dataset.name, annotation.tracingType.toString)),
        "user" -> userJson,
        "owner" -> userJson,
        "contributors" -> contributorsJs,
        "othersMayEdit" -> annotation.othersMayEdit
      )
    }
  }

  def writesWithDataset(annotation: Annotation): Fox[JsObject] = {
    implicit val ctx: DBAccessContext = GlobalAccessContext
    for {
      dataset <- datasetDAO.findOne(annotation._dataset) ?~> "dataset.notFoundForAnnotation"
      tracingStore <- tracingStoreDAO.findFirst
      tracingStoreJs <- tracingStoreService.publicWrites(tracingStore)
      datasetJs <- datasetService.publicWrites(dataset, None, None, None)
    } yield
      Json.obj(
        "id" -> annotation._id.id,
        "name" -> annotation.name,
        "description" -> annotation.description,
        "typ" -> annotation.typ,
        "tracingStore" -> tracingStoreJs,
        "dataset" -> datasetJs
      )
  }

  def writesAsAnnotationSource(annotation: Annotation, accessViaPrivateLink: Boolean): Fox[JsValue] = {
    implicit val ctx: DBAccessContext = GlobalAccessContext
    for {
      dataset <- datasetDAO.findOne(annotation._dataset) ?~> "dataset.notFoundForAnnotation"
      organization <- organizationDAO.findOne(dataset._organization) ?~> "organization.notFound"
      dataStore <- dataStoreDAO.findOneByName(dataset._dataStore.trim) ?~> "datastore.notFound"
      tracingStore <- tracingStoreDAO.findFirst
      annotationSource = AnnotationSource(
        id = annotation.id,
        annotationLayers = annotation.annotationLayers,
        datasetDirectoryName = dataset.directoryName,
        organizationId = organization._id,
        dataStoreUrl = dataStore.publicUrl,
        tracingStoreUrl = tracingStore.publicUrl,
        accessViaPrivateLink = accessViaPrivateLink,
      )
    } yield Json.toJson(annotationSource)
  }

  private def userJsonForAnnotation(userId: ObjectId, userOpt: Option[User] = None): Fox[Option[JsObject]] =
    if (userId == ObjectId.dummyId) {
      Fox.successful(None)
    } else {
      for {
        user <- Fox.fillOption(userOpt)(userService.findOneCached(userId)(GlobalAccessContext)) ?~> "user.notFound"
        userJson <- userService.compactWrites(user)
      } yield Some(userJson)
    }

  //for Explorative Annotations list
  def writeCompactInfo(annotationInfo: AnnotationCompactInfo): JsObject = {
    val teamsJson = annotationInfo.teamNames.indices.map(
      idx =>
        Json.obj(
          "id" -> annotationInfo.teamIds(idx),
          "name" -> annotationInfo.teamNames(idx),
          "organizationId" -> annotationInfo.teamOrganizationIds(idx)
      ))

    val annotationLayerJson = annotationInfo.tracingIds.indices.map(
      idx =>
        Json.obj(
          "tracingId" -> annotationInfo.tracingIds(idx),
          "typ" -> annotationInfo.annotationLayerTypes(idx),
          "name" -> annotationInfo.annotationLayerNames(idx),
          "stats" -> annotationInfo.annotationLayerStatistics(idx)
      )
    )
    val tracingType: String = getAnnotationTypeForTag(annotationInfo)
    Json.obj(
      "modified" -> annotationInfo.modified,
      "state" -> annotationInfo.state,
      "id" -> annotationInfo.id,
      "name" -> annotationInfo.name,
      "description" -> annotationInfo.description,
      "typ" -> annotationInfo.typ,
      "stats" -> Json.obj(), // included for legacy parsers
      "isLockedByOwner" -> annotationInfo.isLockedByOwner,
      "annotationLayers" -> annotationLayerJson,
      "dataSetName" -> annotationInfo.dataSetName,
      "organization" -> annotationInfo.organization,
      "visibility" -> annotationInfo.visibility,
      "tracingTime" -> annotationInfo.tracingTime,
      "teams" -> teamsJson,
      "tags" -> (annotationInfo.tags ++ Set(annotationInfo.dataSetName, tracingType)),
      "owner" -> Json.obj(
        "id" -> annotationInfo.ownerId.toString,
        "firstName" -> annotationInfo.ownerFirstName,
        "lastName" -> annotationInfo.ownerLastName
      ),
      "othersMayEdit" -> annotationInfo.othersMayEdit,
    )
  }

  private def getAnnotationTypeForTag(annotationInfo: AnnotationCompactInfo): String = {
    val skeletonPresent = annotationInfo.annotationLayerTypes.contains(AnnotationLayerType.Skeleton.toString)
    val volumePresent = annotationInfo.annotationLayerTypes.contains(AnnotationLayerType.Volume.toString)
    if (skeletonPresent && volumePresent) {
      "hybrid"
    } else if (skeletonPresent) {
      "skeleton"
    } else {
      "volume"
    }
  }
}
