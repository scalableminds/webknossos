package models.annotation

import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.io.{NamedStream, ZipIO}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits, TextUtils}
import com.scalableminds.webknossos.datastore.Annotation.{AnnotationLayerProto, AnnotationProto}
import com.scalableminds.webknossos.datastore.SkeletonTracing._
import com.scalableminds.webknossos.datastore.VolumeTracing.{VolumeTracing, VolumeTracingOpt, VolumeTracings}
import com.scalableminds.webknossos.datastore.geometry.ColorProto
import com.scalableminds.webknossos.datastore.helpers.{NodeDefaults, ProtoGeometryImplicits, SkeletonTracingDefaults}
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.annotation._
import com.scalableminds.webknossos.datastore.models.datasource.{
  AdditionalAxis,
  ElementClass,
  DataSourceLike => DataSource,
  SegmentationLayerLike => SegmentationLayer
}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.tracingstore.annotation.AnnotationLayerParameters
import com.scalableminds.webknossos.tracingstore.tracings.TracingId
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeDataZipFormat.VolumeDataZipFormat
import com.scalableminds.webknossos.tracingstore.tracings.volume.{
  MagRestrictions,
  VolumeTracingDefaults,
  VolumeTracingMags
}
import com.typesafe.scalalogging.LazyLogging
import files.WkTempFileService
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
import com.scalableminds.util.tools.{Box, Full}
import org.apache.pekko.actor.ActorSystem
import org.apache.pekko.stream.Materializer
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{JsNull, JsObject, JsValue, Json}
import utils.WkConf

import java.io.{BufferedOutputStream, File, FileOutputStream}
import java.nio.file.Path
import javax.inject.Inject
import scala.concurrent.ExecutionContext

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

class AnnotationService @Inject()(
    annotationInformationProvider: AnnotationInformationProvider,
    savedTracingInformationHandler: SavedTracingInformationHandler,
    annotationDAO: AnnotationDAO,
    annotationLayerDAO: AnnotationLayerDAO,
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
    tempFileService: WkTempFileService,
    conf: WkConf,
    rpc: RPC
)(implicit ec: ExecutionContext, val materializer: Materializer)
    extends FoxImplicits
    with ProtoGeometryImplicits
    with AnnotationLayerPrecedence
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
            _ <- Fox.fromBool(isTeamManagerOrAdminOfOrg || dataset.isPublic || user.isDatasetManager)
            organizationTeamId <- organizationDAO.findOrganizationTeamId(user._organization)
          } yield organizationTeamId
      }
    }).flatten

  private def createVolumeTracing(
      dataSource: DataSource,
      datasetOrganizationId: String,
      datasetId: ObjectId,
      datasetDataStore: DataStore,
      fallbackLayer: Option[SegmentationLayer],
      boundingBox: Option[BoundingBox] = None,
      startPosition: Option[Vec3Int] = None,
      startRotation: Option[Vec3Double] = None,
      magRestrictions: MagRestrictions,
      mappingName: Option[String]
  ): Fox[VolumeTracing] = {
    val mags = VolumeTracingMags.magsForVolumeTracing(dataSource, fallbackLayer)
    val magsRestricted = magRestrictions.filterAllowed(mags)
    val additionalAxes =
      fallbackLayer.map(_.additionalAxes).getOrElse(dataSource.additionalAxesUnion)
    for {
      _ <- Fox.fromBool(magsRestricted.nonEmpty) ?~> "annotation.volume.magRestrictionsTooTight"
      remoteDatastoreClient = new WKRemoteDataStoreClient(datasetDataStore, rpc)
      fallbackLayerHasSegmentIndex <- fallbackLayer match {
        case Some(layer) =>
          remoteDatastoreClient.hasSegmentIndexFile(datasetId.toString, layer.name)
        case None => Fox.successful(false)
      }
      elementClassProto <- ElementClass
        .toProto(fallbackLayer.map(layer => layer.elementClass).getOrElse(VolumeTracingDefaults.elementClass))
        .toFox
    } yield
      VolumeTracing(
        None,
        boundingBoxToProto(boundingBox.orElse(fallbackLayer.map(_.boundingBox)).getOrElse(dataSource.boundingBox)),
        System.currentTimeMillis(),
        dataSource.id.directoryName,
        vec3IntToProto(startPosition.getOrElse(dataSource.center)),
        vec3DoubleToProto(startRotation.getOrElse(vec3DoubleFromProto(VolumeTracingDefaults.editRotation))),
        elementClassProto,
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

  def createTracingForExplorational(dataset: Dataset,
                                    params: AnnotationLayerParameters,
                                    existingAnnotationId: Option[ObjectId],
                                    existingAnnotationLayers: List[AnnotationLayer],
                                    previousVersion: Option[Long])(
      implicit ctx: DBAccessContext,
      mp: MessagesProvider): Fox[Either[SkeletonTracing, VolumeTracing]] = {

    def getAutoFallbackLayerName(dataSource: DataSource): Option[String] =
      dataSource.dataLayers.find {
        case _: SegmentationLayer => true
        case _                    => false
      }.map(_.name)

    def getFallbackLayer(dataSource: DataSource, fallbackLayerName: String): Fox[SegmentationLayer] =
      for {
        fallbackLayer <- dataSource.dataLayers
          .filter(dl => dl.name == fallbackLayerName)
          .flatMap {
            case layer: SegmentationLayer => Some(layer)
            case _                        => None
          }
          .headOption
          .toFox
        _ <- Fox.fromBool(
          ElementClass
            .largestSegmentIdIsInRange(fallbackLayer.largestSegmentId, fallbackLayer.elementClass)) ?~> Messages(
          "annotation.volume.largestSegmentIdExceedsRange",
          fallbackLayer.largestSegmentId,
          fallbackLayer.elementClass)
      } yield fallbackLayer

    for {
      dataStore <- dataStoreDAO.findOneByName(dataset._dataStore.trim) ?~> "dataStore.notFoundForDataset"
      inboxDataSource <- datasetService.dataSourceFor(dataset)
      dataSource <- inboxDataSource.toUsable.toFox ?~> Messages("dataset.notImported", inboxDataSource.id.directoryName)
      tracingStoreClient <- tracingStoreService.clientFor(dataset)

      /*
        Note that the tracings have redundant properties, with a precedence logic selecting a layer
        from which the values are used. Adding a layer may change this precedence, so the redundant
        values need to be copied to the new layer from the layer that had precedence before. Otherwise, those
        properties would be masked and lost.
        Unfortunately, their history is still lost since the new layer gets only the latest snapshot.
        We do this for *every* new layer, since we only later get its ID which determines the actual precedence.
        All of this is skipped if existingAnnotationLayers is empty.
       */
      oldPrecedenceLayerProperties <- getOldPrecedenceLayerProperties(existingAnnotationId,
                                                                      existingAnnotationLayers,
                                                                      previousVersion,
                                                                      dataset,
                                                                      tracingStoreClient)
      tracing <- params.typ match {
        case AnnotationLayerType.Skeleton =>
          val skeleton = SkeletonTracingDefaults.createInstance.copy(
            datasetName = dataset.name,
            editPosition = dataSource.center,
            organizationId = Some(dataset._organization),
            additionalAxes = AdditionalAxis.toProto(dataSource.additionalAxesUnion)
          )
          val skeletonAdapted = adaptSkeletonTracing(skeleton, oldPrecedenceLayerProperties)
          Fox.successful(Left(skeletonAdapted))
        case AnnotationLayerType.Volume =>
          val autoFallbackLayerName =
            if (params.autoFallbackLayer) getAutoFallbackLayerName(dataSource) else None
          val fallbackLayerName = params.fallbackLayerName.orElse(autoFallbackLayerName)
          for {
            fallbackLayer <- Fox.runOptional(fallbackLayerName)(n => getFallbackLayer(dataSource, n))
            volumeTracing <- createVolumeTracing(
              dataSource,
              dataset._organization,
              dataset._id,
              dataStore,
              fallbackLayer,
              magRestrictions = params.magRestrictions.getOrElse(MagRestrictions.empty),
              mappingName = params.mappingName
            )
            volumeTracingAdapted = adaptVolumeTracing(volumeTracing, oldPrecedenceLayerProperties)
          } yield Right(volumeTracingAdapted)
      }
    } yield tracing
  }

  private def createLayersForExplorational(dataset: Dataset,
                                           annotationId: ObjectId,
                                           allAnnotationLayerParameters: List[AnnotationLayerParameters])(
      implicit ctx: DBAccessContext,
      mp: MessagesProvider): Fox[List[AnnotationLayer]] =
    for {
      tracingStoreClient <- tracingStoreService.clientFor(dataset)
      dataSource <- datasetService.dataSourceFor(dataset).flatMap(_.toUsable.toFox) ?~> "dataset.dataSource.notUsable"
      newAnnotationLayers <- Fox.serialCombined(allAnnotationLayerParameters) { annotationLayerParameters =>
        for {
          tracing <- createTracingForExplorational(dataset,
                                                   annotationLayerParameters,
                                                   existingAnnotationId = None,
                                                   existingAnnotationLayers = List.empty,
                                                   previousVersion = None)
          layerName = annotationLayerParameters.name.getOrElse(
            AnnotationLayer.defaultNameForType(annotationLayerParameters.typ))
          newTracingId = TracingId.generate
          _ <- tracing match {
            case Left(skeleton) => tracingStoreClient.saveSkeletonTracing(skeleton, newTracingId)
            case Right(volume) =>
              tracingStoreClient.saveVolumeTracing(annotationId, newTracingId, volume, dataSource = dataSource)
          }
        } yield
          AnnotationLayer(newTracingId,
                          annotationLayerParameters.typ,
                          layerName,
                          AnnotationLayerStatistics.zeroedForType(annotationLayerParameters.typ))
      }
      layersProto = newAnnotationLayers.map { l =>
        AnnotationLayerProto(
          l.tracingId,
          l.name,
          AnnotationLayerType.toProto(l.typ)
        )
      }
      annotationProto = AnnotationProto(
        description = AnnotationDefaults.defaultDescription,
        version = 0L,
        annotationLayers = layersProto,
        earliestAccessibleVersion = 0L
      )
      _ <- tracingStoreClient.saveAnnotationProto(annotationId, annotationProto)
    } yield newAnnotationLayers

  def createExplorationalFor(user: User, dataset: Dataset, annotationLayerParameters: List[AnnotationLayerParameters])(
      implicit ctx: DBAccessContext,
      m: MessagesProvider): Fox[Annotation] = {
    val newAnnotationId = ObjectId.generate
    val datasetId = dataset._id
    for {
      annotationLayers <- createLayersForExplorational(dataset, newAnnotationId, annotationLayerParameters) ?~> "annotation.createTracings.failed"
      teamId <- selectSuitableTeam(user, dataset) ?~> "annotation.create.forbidden"
      annotation = Annotation(newAnnotationId, datasetId, None, teamId, user._id, annotationLayers)
      _ <- annotationDAO.insertOne(annotation)
    } yield annotation
  }

  // WARNING: needs to be repeatable, might be called multiple times for an annotation
  def finish(annotation: Annotation, user: User, restrictions: AnnotationRestrictions)(
      implicit ctx: DBAccessContext): Fox[String] = {
    def executeFinish: Fox[String] =
      for {
        _ <- annotationDAO.updateModified(annotation._id, Instant.now)
        _ <- annotationDAO.updateState(annotation._id, AnnotationState.Finished)
        _ <- Fox.runOptional(annotation._task)(taskService.clearCompoundCache)
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

  def annotationsFor(taskId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[Annotation]] =
    annotationDAO.findAllByTaskIdAndType(taskId, AnnotationType.Task)

  def createAnnotationFor(user: User, taskId: ObjectId, initializingAnnotationId: ObjectId)(
      implicit m: MessagesProvider,
      ctx: DBAccessContext): Fox[Annotation] =
    for {
      annotationBaseId <- annotationDAO.findBaseIdForTask(taskId) ?~> "Failed to retrieve annotation base id."
      annotationBase <- annotationDAO.findOne(annotationBaseId) ?~> "Failed to retrieve annotation base."
      datasetName <- datasetDAO.getNameById(annotationBase._dataset)(GlobalAccessContext) ?~> "dataset.notFoundForAnnotation"
      dataset <- datasetDAO.findOne(annotationBase._dataset) ?~> Messages("dataset.noAccess", datasetName)
      _ <- Fox.fromBool(dataset.isUsable) ?~> Messages("dataset.notImported", dataset.name)
      tracingStoreClient <- tracingStoreService.clientFor(dataset)
      _ = logger.info(
        f"task assignment. creating annotation $initializingAnnotationId from base $annotationBaseId for task $taskId")
      duplicatedAnnotationProto <- tracingStoreClient.duplicateAnnotation(
        annotationBaseId,
        initializingAnnotationId,
        annotationBase._user,
        user._id,
        version = None,
        isFromTask = false, // isFromTask is when duplicate is called on a task annotation, not when a task is assigned
        datasetBoundingBox = None
      )
      newAnnotation = annotationBase.copy(
        _id = initializingAnnotationId,
        _user = user._id,
        annotationLayers = duplicatedAnnotationProto.annotationLayers.map(AnnotationLayer.fromProto).toList,
        state = Active,
        typ = AnnotationType.Task,
        created = Instant.now,
        modified = Instant.now
      )
      _ <- annotationDAO.updateInitialized(newAnnotation)
    } yield newAnnotation

  def createSkeletonTracingBase(boundingBox: Option[BoundingBox],
                                startPosition: Vec3Int,
                                startRotation: Vec3Double): SkeletonTracing = {
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
    SkeletonTracingDefaults.createInstance.copy(
      datasetName = "unused",
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
      dataSource <- datasetService.dataSourceFor(dataset).flatMap(_.toUsable.toFox)
      dataStore <- dataStoreDAO.findOneByName(dataset._dataStore.trim)
      fallbackLayer = if (volumeShowFallbackLayer) {
        dataSource.dataLayers.flatMap {
          case layer: SegmentationLayer => Some(layer)
          case _                        => None
        }.headOption
      } else None
      _ <- Fox.fromBool(fallbackLayer.forall(_.largestSegmentId.exists(_ >= 0L))) ?~> "annotation.volume.invalidLargestSegmentId"

      volumeTracing <- createVolumeTracing(
        dataSource,
        dataset._organization,
        datasetId,
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

  // Save annotation base to postgres AND annotation proto to tracingstore.
  def createAndSaveAnnotationBase(
      taskFox: Fox[Task],
      userId: ObjectId,
      skeletonTracingIdBox: Box[Option[String]],
      volumeTracingIdBox: Box[Option[String]],
      datasetId: ObjectId,
      description: Option[String],
      tracingStoreClient: WKRemoteTracingStoreClient
  )(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      task <- taskFox
      skeletonIdOpt <- skeletonTracingIdBox.toFox
      volumeIdOpt <- volumeTracingIdBox.toFox
      _ <- Fox.fromBool(skeletonIdOpt.isDefined || volumeIdOpt.isDefined) ?~> "annotation.needsAtleastOne"
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
      annotationBaseProto = AnnotationProto(
        description = AnnotationDefaults.defaultDescription,
        version = 0L,
        annotationLayers = annotationLayers.map(_.toProto),
        earliestAccessibleVersion = 0L
      )
      _ <- tracingStoreClient.saveAnnotationProto(annotationBase._id, annotationBaseProto)
      _ <- annotationDAO.insertOne(annotationBase)
    } yield ()

  def createFrom(user: User,
                 dataset: Dataset,
                 annotationLayers: Seq[AnnotationLayer],
                 annotationType: AnnotationType,
                 name: Option[String],
                 description: String,
                 newAnnotationId: ObjectId): Fox[Annotation] =
    for {
      teamId <- selectSuitableTeam(user, dataset)
      annotation = Annotation(newAnnotationId,
                              dataset._id,
                              None,
                              teamId,
                              user._id,
                              annotationLayers.toList,
                              description,
                              name = name.getOrElse(""),
                              typ = annotationType)
    } yield annotation

  def updateTeamsForSharedAnnotation(annotationId: ObjectId, teams: List[ObjectId])(
      implicit ctx: DBAccessContext): Fox[Unit] =
    annotationDAO.updateTeamsForSharedAnnotation(annotationId, teams)

  def zipAnnotations(annotations: List[Annotation],
                     zipFileName: String,
                     skipVolumeData: Boolean,
                     volumeDataZipFormat: VolumeDataZipFormat)(implicit
                                                               ctx: DBAccessContext): Fox[Path] =
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
            // user state is not used in compound download, so the annotationProto can be a dummy one and requestingUser can be None.
            annotationProto = AnnotationProto("", 0L, Seq.empty, 0L)
            nml = nmlWriter.toNmlStream(
              name,
              annotationProto,
              fetchedAnnotationLayersForAnnotation,
              Some(annotation),
              voxelSizeOpt,
              Some(name + "_data.zip"),
              organizationId,
              conf.Http.uri,
              datasetName,
              datasetId,
              user,
              taskOpt,
              skipVolumeData,
              volumeDataZipFormat,
              requestingUser = None
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
              .getVolumeData(tracingId, volumeDataZipFormat = volumeDataZipFormat, voxelSize = dataset.voxelSize)
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

  private def createZip(nmls: List[(NamedStream, Option[Array[Byte]])], zipFileName: String): Fox[Path] = {
    val zipped = tempFileService.create(TextUtils.normalize(zipFileName))
    val zipper = ZipIO.startZip(new BufferedOutputStream(new FileOutputStream(new File(zipped.toString))))

    def addToZip(nmls: List[(NamedStream, Option[Array[Byte]])]): Fox[Boolean] =
      nmls match {
        case (nml, volumeDataOpt) :: tail =>
          if (volumeDataOpt.isDefined) {
            val subZip = tempFileService.create(TextUtils.normalize(nml.name))
            val subZipper =
              ZipIO.startZip(new BufferedOutputStream(new FileOutputStream(new File(subZip.toString))))
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
          Fox.successful(true)
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

  def resetToBase(annotation: Annotation)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- Fox.fromBool(annotation.typ == AnnotationType.Task) ?~> "annotation.revert.tasksOnly"
      dataset <- datasetDAO.findOne(annotation._dataset)
      tracingStoreClient <- tracingStoreService.clientFor(dataset)
      _ <- tracingStoreClient.resetToBase(annotation._id) ?~> "annotation.revert.failed"
    } yield ()

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
      taskFox = annotation._task.toFox.flatMap(taskId => taskDAO.findOne(taskId))
      taskJson <- Fox.fromFuture(taskFox.flatMap(t => taskService.publicWrites(t)).getOrElse(JsNull))
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
        id = annotation._id,
        annotationLayers = annotation.annotationLayers,
        datasetDirectoryName = dataset.directoryName,
        datasetId = dataset._id,
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

  def updateStatistics(annotationId: ObjectId, statistics: JsObject): Unit =
    // Fail silently, because the layer may not (yet/anymore) be present in postgres at this time
    statistics.value.toSeq.map {
      case (tracingId, statisticsForTracing) =>
        annotationLayerDAO.updateStatistics(annotationId, tracingId, statisticsForTracing)
    }

}
