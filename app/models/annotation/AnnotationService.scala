package models.annotation

import java.io.{BufferedOutputStream, File, FileOutputStream}

import akka.actor.ActorSystem
import akka.stream.ActorMaterializer
import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Scale, Vector3D}
import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.tools.{BoxImplicits, Fox, FoxImplicits, TextUtils}
import com.scalableminds.webknossos.datastore.models.datasource.{
  ElementClass,
  DataSourceLike => DataSource,
  SegmentationLayerLike => SegmentationLayer
}
import com.scalableminds.webknossos.datastore.SkeletonTracing._
import com.scalableminds.webknossos.datastore.VolumeTracing.{VolumeTracing, VolumeTracingOpt, VolumeTracings}
import com.scalableminds.webknossos.datastore.geometry.{Color, NamedBoundingBox}
import com.scalableminds.webknossos.datastore.helpers.{NodeDefaults, ProtoGeometryImplicits, SkeletonTracingDefaults}
import com.scalableminds.webknossos.tracingstore.tracings._
import com.scalableminds.webknossos.tracingstore.tracings.volume.{
  ResolutionRestrictions,
  VolumeTracingDefaults,
  VolumeTracingDownsampling
}
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.annotation.AnnotationState._
import models.annotation.AnnotationType.AnnotationType
import models.annotation.handler.SavedTracingInformationHandler
import models.annotation.nml.NmlWriter
import models.binary._
import models.mesh.{MeshDAO, MeshService}
import models.project.ProjectDAO
import models.task.{Task, TaskDAO, TaskService, TaskTypeDAO}
import models.team.{OrganizationDAO, Team, TeamDAO}
import models.user.{User, UserDAO, UserService}
import net.liftweb.common.{Box, Full}
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.Files.{TemporaryFile, TemporaryFileCreator}
import play.api.libs.iteratee.Enumerator
import play.api.libs.json.{JsNull, JsObject, Json}
import utils.ObjectId

import scala.concurrent.{ExecutionContext, Future}

case class DownloadAnnotation(skeletonTracingOpt: Option[SkeletonTracing],
                              volumeTracingOpt: Option[VolumeTracing],
                              volumeDataOpt: Option[Array[Byte]],
                              name: String,
                              scaleOpt: Option[Scale],
                              annotation: Annotation,
                              user: User,
                              taskOpt: Option[Task],
                              organizationName: String)

class AnnotationService @Inject()(annotationInformationProvider: AnnotationInformationProvider,
                                  savedTracingInformationHandler: SavedTracingInformationHandler,
                                  annotationDAO: AnnotationDAO,
                                  userDAO: UserDAO,
                                  taskTypeDAO: TaskTypeDAO,
                                  taskService: TaskService,
                                  dataSetService: DataSetService,
                                  dataSetDAO: DataSetDAO,
                                  dataStoreService: DataStoreService,
                                  tracingStoreService: TracingStoreService,
                                  tracingStoreDAO: TracingStoreDAO,
                                  taskDAO: TaskDAO,
                                  teamDAO: TeamDAO,
                                  userService: UserService,
                                  dataStoreDAO: DataStoreDAO,
                                  projectDAO: ProjectDAO,
                                  organizationDAO: OrganizationDAO,
                                  annotationRestrictionDefults: AnnotationRestrictionDefaults,
                                  nmlWriter: NmlWriter,
                                  temporaryFileCreator: TemporaryFileCreator,
                                  meshDAO: MeshDAO,
                                  meshService: MeshService,
                                  sharedAnnotationsDAO: SharedAnnotationsDAO)(implicit ec: ExecutionContext)
    extends BoxImplicits
    with FoxImplicits
    with TextUtils
    with ProtoGeometryImplicits
    with LazyLogging {
  implicit val actorSystem: ActorSystem = ActorSystem()
  implicit val materializer: ActorMaterializer = ActorMaterializer()

  private def selectSuitableTeam(user: User, dataSet: DataSet)(implicit ctx: DBAccessContext): Fox[ObjectId] =
    (for {
      userTeamIds <- userService.teamIdsFor(user._id)
      datasetAllowedTeamIds <- dataSetService.allowedTeamIdsFor(dataSet._id)
    } yield {
      val selectedTeamOpt = datasetAllowedTeamIds.intersect(userTeamIds).headOption
      selectedTeamOpt match {
        case Some(selectedTeam) => Fox.successful(selectedTeam)
        case None =>
          for {
            isTeamManagerOrAdminOfOrg <- userService.isTeamManagerOrAdminOfOrg(user, user._organization)
            _ <- bool2Fox(isTeamManagerOrAdminOfOrg || dataSet.isPublic || user.isDatasetManager)
            organizationTeamId <- organizationDAO.findOrganizationTeamId(user._organization)
          } yield organizationTeamId
      }
    }).flatten

  private def createVolumeTracing(
      dataSource: DataSource,
      organizationName: String,
      fallbackLayer: Option[SegmentationLayer],
      boundingBox: Option[BoundingBox] = None,
      startPosition: Option[Point3D] = None,
      startRotation: Option[Vector3D] = None,
      resolutionRestrictions: ResolutionRestrictions = ResolutionRestrictions.empty
  ): Fox[VolumeTracing] = {
    val resolutions = VolumeTracingDownsampling.resolutionsForVolumeTracing(dataSource, fallbackLayer)
    val resolutionsRestricted = resolutionRestrictions.filterAllowed(resolutions)
    for {
      _ <- bool2Fox(resolutionsRestricted.nonEmpty) ?~> "annotation.volume.resolutionRestrictionsTooTight"
    } yield
      VolumeTracing(
        None,
        boundingBoxToProto(boundingBox.getOrElse(dataSource.boundingBox)),
        System.currentTimeMillis(),
        dataSource.id.name,
        point3DToProto(startPosition.getOrElse(dataSource.center)),
        vector3DToProto(startRotation.getOrElse(vector3DFromProto(VolumeTracingDefaults.editRotation))),
        elementClassToProto(
          fallbackLayer.map(layer => layer.elementClass).getOrElse(VolumeTracingDefaults.elementClass)),
        fallbackLayer.map(_.name),
        fallbackLayer.map(_.largestSegmentId).getOrElse(VolumeTracingDefaults.largestSegmentId),
        0,
        VolumeTracingDefaults.zoomLevel,
        organizationName = Some(organizationName),
        resolutions = resolutionsRestricted.map(point3DToProto)
      )
  }

  def createTracingsForExplorational(
      dataSet: DataSet,
      dataSource: DataSource,
      tracingType: TracingType.Value,
      withFallback: Boolean,
      organizationName: String,
      oldTracingId: Option[String] = None)(implicit ctx: DBAccessContext): Fox[(Option[String], Option[String])] = {
    def getFallbackLayer: Option[SegmentationLayer] =
      if (withFallback) {
        dataSource.dataLayers.flatMap {
          case layer: SegmentationLayer => Some(layer)
          case _                        => None
        }.headOption
      } else None

    tracingType match {
      case TracingType.skeleton =>
        for {
          client <- tracingStoreService.clientFor(dataSet)
          oldTracingOpt <- Fox.runOptional(oldTracingId)(id => client.getVolumeTracing(id, skipVolumeData = true))
          userBBoxOpt = oldTracingOpt.flatMap(_._1.userBoundingBox).map(NamedBoundingBox(0, None, None, None, _))
          userBBoxes = oldTracingOpt.map(_._1.userBoundingBoxes ++ userBBoxOpt)
          skeletonTracingId <- client.saveSkeletonTracing(
            SkeletonTracingDefaults.createInstance.copy(
              dataSetName = dataSet.name,
              editPosition = dataSource.center,
              userBoundingBox = None,
              organizationName = Some(organizationName),
              userBoundingBoxes = userBBoxes.getOrElse(Seq.empty)
            ))
        } yield (Some(skeletonTracingId), None)
      case TracingType.volume =>
        for {
          client <- tracingStoreService.clientFor(dataSet)
          fallbackLayer = getFallbackLayer
          _ <- bool2Fox(fallbackLayer.forall(_.elementClass != ElementClass.uint64)) ?~> "annotation.volume.uint64"
          volumeTracing <- createVolumeTracing(dataSource, organizationName, fallbackLayer)
          volumeTracingId <- client.saveVolumeTracing(volumeTracing)
        } yield (None, Some(volumeTracingId))
      case TracingType.hybrid =>
        for {
          client <- tracingStoreService.clientFor(dataSet)
          fallbackLayer = getFallbackLayer
          _ <- bool2Fox(fallbackLayer.forall(_.elementClass != ElementClass.uint64)) ?~> "annotation.volume.uint64"
          skeletonTracingId <- client.saveSkeletonTracing(
            SkeletonTracingDefaults.createInstance.copy(dataSetName = dataSet.name,
                                                        editPosition = dataSource.center,
                                                        organizationName = Some(organizationName)))
          volumeTracing <- createVolumeTracing(dataSource, organizationName, fallbackLayer)
          volumeTracingId <- client.saveVolumeTracing(volumeTracing)
        } yield (Some(skeletonTracingId), Some(volumeTracingId))
    }
  }

  def createExplorationalFor(user: User, _dataSet: ObjectId, tracingType: TracingType.Value, withFallback: Boolean)(
      implicit ctx: DBAccessContext,
      m: MessagesProvider): Fox[Annotation] =
    for {
      dataSet <- dataSetDAO.findOne(_dataSet) ?~> "dataSet.noAccessById"
      dataSource <- dataSetService.dataSourceFor(dataSet)
      organization <- organizationDAO.findOne(user._organization)
      usableDataSource <- dataSource.toUsable ?~> Messages("dataSet.notImported", dataSource.id.name)
      tracingIds <- createTracingsForExplorational(dataSet,
                                                   usableDataSource,
                                                   tracingType,
                                                   withFallback,
                                                   organization.name)
      teamId <- selectSuitableTeam(user, dataSet) ?~> "annotation.create.forbidden"
      annotation = Annotation(
        ObjectId.generate,
        _dataSet,
        None,
        teamId,
        user._id,
        tracingIds._1,
        tracingIds._2
      )
      _ <- annotationDAO.insertOne(annotation)
    } yield {
      annotation
    }

  def makeAnnotationHybrid(annotation: Annotation, organizationName: String)(
      implicit ctx: DBAccessContext): Fox[Unit] = {
    def createNewTracings(dataSet: DataSet, dataSource: DataSource) = annotation.tracingType match {
      case TracingType.skeleton =>
        createTracingsForExplorational(dataSet, dataSource, TracingType.volume, withFallback = true, organizationName).flatMap {
          case (_, Some(volumeId)) => annotationDAO.updateVolumeTracingId(annotation._id, volumeId)
          case _                   => Fox.failure("unexpectedReturn")
        }
      case TracingType.volume =>
        createTracingsForExplorational(dataSet,
                                       dataSource,
                                       TracingType.skeleton,
                                       withFallback = false,
                                       organizationName,
                                       annotation.volumeTracingId).flatMap {
          case (Some(skeletonId), _) => annotationDAO.updateSkeletonTracingId(annotation._id, skeletonId)
          case _                     => Fox.failure("unexpectedReturn")
        }
      case _ => Fox.failure("annotation.makeHybrid.alreadyHybrid")
    }

    for {
      dataSet <- dataSetDAO.findOne(annotation._dataSet) ?~> "dataSet.notFoundForAnnotation"
      dataSource <- dataSetService.dataSourceFor(dataSet).flatMap(_.toUsable) ?~> "dataSource.notFound"
      _ <- createNewTracings(dataSet, dataSource) ?~> "makeHybrid.createTracings.failed"
    } yield ()

  }

  def downsampleAnnotation(annotation: Annotation)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      dataSet <- dataSetDAO.findOne(annotation._dataSet) ?~> "dataSet.notFoundForAnnotation"
      originalVolumeTracingId <- annotation.volumeTracingId ?~> "annotation.downsample.volumeOnly"
      rpcClient <- tracingStoreService.clientFor(dataSet)
      newVolumeTracingId <- rpcClient.duplicateVolumeTracing(originalVolumeTracingId, downsample = true)
      _ = logger.info(
        s"Replacing volume tracing $originalVolumeTracingId by downsampled copy $newVolumeTracingId for annotation ${annotation._id}.")
      _ <- annotationDAO.updateVolumeTracingId(annotation._id, newVolumeTracingId)
    } yield ()

  // WARNING: needs to be repeatable, might be called multiple times for an annotation
  def finish(annotation: Annotation, user: User, restrictions: AnnotationRestrictions)(
      implicit ctx: DBAccessContext): Fox[String] = {
    def executeFinish: Fox[String] =
      for {
        _ <- annotationDAO.updateModified(annotation._id, System.currentTimeMillis)
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
            s"Silently not finishing annotation ${annotation._id.toString} for it is aready finished. Access context: ${ctx.toStringAnonymous}")
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

  private def tracingFromBase(annotationBase: Annotation, dataSet: DataSet)(
      implicit ctx: DBAccessContext,
      m: MessagesProvider): Fox[(Option[String], Option[String])] =
    for {
      _ <- bool2Fox(dataSet.isUsable) ?~> Messages("dataSet.notImported", dataSet.name)
      tracingStoreClient <- tracingStoreService.clientFor(dataSet)
      newSkeletonId: Option[String] <- Fox.runOptional(annotationBase.skeletonTracingId)(skeletonId =>
        tracingStoreClient.duplicateSkeletonTracing(skeletonId))
      newVolumeId: Option[String] <- Fox.runOptional(annotationBase.volumeTracingId)(volumeId =>
        tracingStoreClient.duplicateVolumeTracing(volumeId))
    } yield (newSkeletonId, newVolumeId)

  def createAnnotationFor(user: User, task: Task, initializingAnnotationId: ObjectId)(
      implicit m: MessagesProvider,
      ctx: DBAccessContext): Fox[Annotation] = {
    def useAsTemplateAndInsert(annotation: Annotation) =
      for {
        dataSetName <- dataSetDAO.getNameById(annotation._dataSet)(GlobalAccessContext) ?~> "dataSet.notFoundForAnnotation"
        dataSet <- dataSetDAO.findOne(annotation._dataSet) ?~> Messages("dataSet.noAccess", dataSetName)
        (newSkeletonId, newVolumeId) <- tracingFromBase(annotation, dataSet) ?~> s"Failed to use annotation base as template for task ${task._id} with annotation base ${annotation._id}"
        newAnnotation = annotation.copy(
          _id = initializingAnnotationId,
          _user = user._id,
          skeletonTracingId = newSkeletonId,
          volumeTracingId = newVolumeId,
          state = Active,
          typ = AnnotationType.Task,
          created = System.currentTimeMillis,
          modified = System.currentTimeMillis
        )
        _ <- annotationDAO.updateInitialized(newAnnotation)
      } yield {
        newAnnotation
      }

    for {
      annotationBase <- baseForTask(task._id) ?~> "Failed to retrieve annotation base."
      result <- useAsTemplateAndInsert(annotationBase).toFox
    } yield {
      result
    }
  }

  def createSkeletonTracingBase(dataSetName: String,
                                boundingBox: Option[BoundingBox],
                                startPosition: Point3D,
                                startRotation: Vector3D): SkeletonTracing = {
    val initialNode = NodeDefaults.createInstance.withId(1).withPosition(startPosition).withRotation(startRotation)
    val initialTree = Tree(
      1,
      Seq(initialNode),
      Seq.empty,
      Some(Color(1, 0, 0, 1)),
      Seq(BranchPoint(initialNode.id, System.currentTimeMillis())),
      Seq.empty,
      "",
      System.currentTimeMillis()
    )
    SkeletonTracingDefaults.createInstance.copy(
      dataSetName = dataSetName,
      boundingBox = boundingBox.flatMap { box =>
        if (box.isEmpty) None else Some(box)
      },
      editPosition = startPosition,
      editRotation = startRotation,
      activeNodeId = Some(1),
      trees = Seq(initialTree)
    )
  }

  def createVolumeTracingBase(dataSetName: String,
                              organizationId: ObjectId,
                              boundingBox: Option[BoundingBox],
                              startPosition: Point3D,
                              startRotation: Vector3D,
                              volumeShowFallbackLayer: Boolean,
                              resolutionRestrictions: ResolutionRestrictions)(implicit ctx: DBAccessContext,
                                                                              m: MessagesProvider): Fox[VolumeTracing] =
    for {
      organization <- organizationDAO.findOne(organizationId)
      dataSet <- dataSetDAO.findOneByNameAndOrganization(dataSetName, organizationId) ?~> Messages("dataset.notFound",
                                                                                                   dataSetName)
      dataSource <- dataSetService.dataSourceFor(dataSet).flatMap(_.toUsable)

      fallbackLayer = if (volumeShowFallbackLayer) {
        dataSource.dataLayers.flatMap {
          case layer: SegmentationLayer => Some(layer)
          case _                        => None
        }.headOption
      } else None
      _ <- bool2Fox(fallbackLayer.forall(_.elementClass != ElementClass.uint64)) ?~> "annotation.volume.uint64"

      volumeTracing <- createVolumeTracing(
        dataSource,
        organization.name,
        fallbackLayer = fallbackLayer,
        boundingBox = boundingBox.flatMap { box =>
          if (box.isEmpty) None else Some(box)
        },
        startPosition = Some(startPosition),
        startRotation = Some(startRotation),
        resolutionRestrictions = resolutionRestrictions
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
      dataSetId: ObjectId,
      description: Option[String]
  )(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      task <- taskFox
      skeletonIdOpt <- skeletonTracingIdBox.toFox
      volumeIdOpt <- volumeTracingIdBox.toFox
      _ <- bool2Fox(skeletonIdOpt.isDefined || volumeIdOpt.isDefined) ?~> "annotation.needsAtleastOne"
      project <- projectDAO.findOne(task._project)
      annotationBase = Annotation(ObjectId.generate,
                                  dataSetId,
                                  Some(task._id),
                                  project._team,
                                  userId,
                                  skeletonIdOpt,
                                  volumeIdOpt,
                                  description.getOrElse(""),
                                  typ = AnnotationType.TracingBase)
      _ <- annotationDAO.insertOne(annotationBase)
    } yield ()

  def createFrom(user: User,
                 dataSet: DataSet,
                 skeletonTracingId: Option[String],
                 volumeTracingId: Option[String],
                 annotationType: AnnotationType,
                 name: Option[String],
                 description: String)(implicit m: MessagesProvider, ctx: DBAccessContext): Fox[Annotation] =
    for {
      teamId <- selectSuitableTeam(user, dataSet)
      annotation = Annotation(ObjectId.generate,
                              dataSet._id,
                              None,
                              teamId,
                              user._id,
                              skeletonTracingId,
                              volumeTracingId,
                              description,
                              name = name.getOrElse(""),
                              typ = annotationType)
      _ <- annotationDAO.insertOne(annotation)
    } yield annotation

  def sharedAnnotationsFor(userTeams: List[ObjectId])(implicit ctx: DBAccessContext): Fox[List[Annotation]] =
    sharedAnnotationsDAO.findAllSharedForTeams(userTeams)

  def updateTeamsForSharedAnnotation(annotationId: ObjectId, teams: List[ObjectId])(
      implicit ctx: DBAccessContext): Fox[Unit] =
    sharedAnnotationsDAO.updateTeamsForSharedAnnotation(annotationId, teams)

  def sharedTeamsFor(annotationId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[Team]] =
    for {
      teamIds <- sharedAnnotationsDAO.sharedTeamsFor(annotationId)
      teamIdsValidated <- Fox.serialCombined(teamIds)(ObjectId.parse(_))
      teams <- Fox.serialCombined(teamIdsValidated)(teamDAO.findOne(_))
    } yield teams

  def zipAnnotations(annotations: List[Annotation], zipFileName: String, skipVolumeData: Boolean)(
      implicit m: MessagesProvider,
      ctx: DBAccessContext): Fox[TemporaryFile] =
    for {
      downloadAnnotations <- getTracingsScalesAndNamesFor(annotations, skipVolumeData)
      nmlsAndNames = downloadAnnotations.flatten.map {
        case DownloadAnnotation(skeletonTracingOpt,
                                volumeTracingOpt,
                                volumeDataOpt,
                                name,
                                scaleOpt,
                                annotation,
                                user,
                                taskOpt,
                                organizationName) =>
          (nmlWriter.toNmlStream(skeletonTracingOpt,
                                 volumeTracingOpt,
                                 Some(annotation),
                                 scaleOpt,
                                 Some(name + "_data.zip"),
                                 organizationName,
                                 Some(user),
                                 taskOpt),
           name,
           volumeDataOpt)
      }

      zip <- createZip(nmlsAndNames, zipFileName)
    } yield zip

  private def getTracingsScalesAndNamesFor(annotations: List[Annotation], skipVolumeData: Boolean)(
      implicit ctx: DBAccessContext): Fox[List[List[DownloadAnnotation]]] = {

    def getSingleDownloadAnnotation(annotation: Annotation, scaleOpt: Option[Scale]) =
      for {
        user <- userService.findOneById(annotation._user, useCache = true) ?~> "user.notFound"
        taskOpt <- Fox.runOptional(annotation._task)(taskDAO.findOne) ?~> "task.notFound"
        name <- savedTracingInformationHandler.nameForAnnotation(annotation)
        organizationName <- organizationDAO.findOrganizationNameForAnnotation(annotation._id)
      } yield DownloadAnnotation(None, None, None, name, scaleOpt, annotation, user, taskOpt, organizationName)

    def getSkeletonTracings(dataSetId: ObjectId, tracingIds: List[Option[String]]): Fox[List[Option[SkeletonTracing]]] =
      for {
        dataSet <- dataSetDAO.findOne(dataSetId)
        tracingStoreClient <- tracingStoreService.clientFor(dataSet)
        tracingContainers: List[SkeletonTracings] <- Fox.serialCombined(tracingIds.grouped(1000).toList)(
          tracingStoreClient.getSkeletonTracings)
        tracingOpts: List[SkeletonTracingOpt] = tracingContainers.flatMap(_.tracings)
      } yield tracingOpts.map(_.tracing)

    def getVolumeTracings(dataSetId: ObjectId, tracingIds: List[Option[String]]): Fox[List[Option[VolumeTracing]]] =
      for {
        dataSet <- dataSetDAO.findOne(dataSetId)
        tracingStoreClient <- tracingStoreService.clientFor(dataSet)
        tracingContainers: List[VolumeTracings] <- Fox.serialCombined(tracingIds.grouped(1000).toList)(
          tracingStoreClient.getVolumeTracings)
        tracingOpts: List[VolumeTracingOpt] = tracingContainers.flatMap(_.tracings)
      } yield tracingOpts.map(_.tracing)

    def getVolumeDataObjects(dataSetId: ObjectId, tracingIds: List[Option[String]]): Fox[List[Option[Array[Byte]]]] =
      for {
        dataSet <- dataSetDAO.findOne(dataSetId)
        tracingStoreClient <- tracingStoreService.clientFor(dataSet)
        tracingDataObjects: List[Option[Array[Byte]]] <- Fox.serialCombined(tracingIds) {
          case None                      => Fox.successful(None)
          case Some(_) if skipVolumeData => Fox.successful(None)
          case Some(tracingId)           => tracingStoreClient.getVolumeData(tracingId).map(Some(_))
        }
      } yield tracingDataObjects

    def getDatasetScale(dataSetId: ObjectId) =
      for {
        dataSet <- dataSetDAO.findOne(dataSetId)
      } yield dataSet.scale

    val annotationsGrouped: Map[ObjectId, List[Annotation]] = annotations.groupBy(_._dataSet)
    val tracingsGrouped = annotationsGrouped.map {
      case (dataSetId, annotations) =>
        for {
          scale <- getDatasetScale(dataSetId)
          skeletonTracings <- getSkeletonTracings(dataSetId, annotations.map(_.skeletonTracingId))
          volumeTracings <- getVolumeTracings(dataSetId, annotations.map(_.volumeTracingId))
          volumeDataObjects <- getVolumeDataObjects(dataSetId, annotations.map(_.volumeTracingId))
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

  private def createZip(nmls: List[(Enumerator[Array[Byte]], String, Option[Array[Byte]])],
                        zipFileName: String): Future[TemporaryFile] = {
    val zipped = temporaryFileCreator.create(normalize(zipFileName), ".zip")
    val zipper = ZipIO.startZip(new BufferedOutputStream(new FileOutputStream(new File(zipped.path.toString))))

    def addToZip(nmls: List[(Enumerator[Array[Byte]], String, Option[Array[Byte]])]): Future[Boolean] =
      nmls match {
        case (nml, name, volumeDataOpt) :: tail =>
          if (volumeDataOpt.isDefined) {
            val subZip = temporaryFileCreator.create(normalize(name), ".zip")
            val subZipper =
              ZipIO.startZip(new BufferedOutputStream(new FileOutputStream(new File(subZip.path.toString))))
            volumeDataOpt.foreach(volumeData => subZipper.addFileFromBytes(name + "_data.zip", volumeData))
            for {
              _ <- subZipper.addFileFromEnumerator(name + ".nml", nml)
              _ = subZipper.close()
              _ = zipper.addFileFromTemporaryFile(name + ".zip", subZip)
              res <- addToZip(tail)
            } yield res
          } else {
            zipper.addFileFromEnumerator(name + ".nml", nml).flatMap(_ => addToZip(tail))
          }
        case _ =>
          Future.successful(true)
      }

    addToZip(nmls).map { _ =>
      zipper.close()
      zipped
    }
  }

  def transferAnnotationToUser(typ: String, id: String, userId: ObjectId, issuingUser: User)(
      implicit ctx: DBAccessContext): Fox[Annotation] =
    for {
      annotation <- annotationInformationProvider.provideAnnotation(typ, id, issuingUser) ?~> "annotation.notFound"
      newUser <- userDAO.findOne(userId) ?~> "user.notFound"
      _ <- dataSetDAO.findOne(annotation._dataSet)(AuthorizedAccessContext(newUser)) ?~> "annotation.transferee.noDataSetAccess"
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
          _ = logger.warn(
            s"Resetting annotation ${annotation._id} to base, discarding skeleton tracing ${annotation.skeletonTracingId} and/or volume tracing ${annotation.volumeTracingId}")
          annotationBase <- baseForTask(task._id)
          dataSet <- dataSetDAO.findOne(annotationBase._dataSet)(GlobalAccessContext) ?~> "dataSet.notFoundForAnnotation"
          (newSkeletonIdOpt, newVolumeIdOpt) <- tracingFromBase(annotationBase, dataSet)
          _ <- Fox.bool2Fox(newSkeletonIdOpt.isDefined || newVolumeIdOpt.isDefined) ?~> "annotation.needsEitherSkeletonOrVolume"
          _ <- Fox.runOptional(newSkeletonIdOpt)(newSkeletonId =>
            annotationDAO.updateSkeletonTracingId(annotation._id, newSkeletonId))
          _ <- Fox.runOptional(newVolumeIdOpt)(newVolumeId =>
            annotationDAO.updateVolumeTracingId(annotation._id, newVolumeId))
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
    annotation._task.toFox.flatMap(taskId => taskDAO.findOne(taskId)(GlobalAccessContext))

  def publicWrites(annotation: Annotation,
                   requestingUser: Option[User] = None,
                   restrictionsOpt: Option[AnnotationRestrictions] = None): Fox[JsObject] = {
    implicit val ctx: DBAccessContext = GlobalAccessContext
    for {
      dataSet <- dataSetDAO.findOne(annotation._dataSet) ?~> "dataSet.notFoundForAnnotation"
      organization <- organizationDAO.findOne(dataSet._organization) ?~> "organization.notFound"
      task = annotation._task.toFox.flatMap(taskId => taskDAO.findOne(taskId))
      taskJson <- task.flatMap(t => taskService.publicWrites(t)).getOrElse(JsNull)
      user <- userService.findOneById(annotation._user, useCache = true)(GlobalAccessContext)
      isTeamManagerOrAdminOfOwner <- Fox.runOptional(requestingUser)(requester =>
        userService.isTeamManagerOrAdminOf(requester, user))
      userJson <- if (isTeamManagerOrAdminOfOwner.getOrElse(false)) userService.compactWrites(user).map(Some(_))
      else Fox.successful(None)
      settings <- settingsFor(annotation)
      restrictionsJs <- AnnotationRestrictions.writeAsJson(
        restrictionsOpt.getOrElse(annotationRestrictionDefults.defaultsFor(annotation)),
        requestingUser)
      dataStore <- dataStoreDAO.findOneByName(dataSet._dataStore.trim) ?~> "datastore.notFound"
      dataStoreJs <- dataStoreService.publicWrites(dataStore)
      meshes <- meshDAO.findAllWithAnnotation(annotation._id)
      meshesJs <- Fox.serialCombined(meshes)(meshService.publicWrites)
      tracingStore <- tracingStoreDAO.findFirst
      tracingStoreJs <- tracingStoreService.publicWrites(tracingStore)
    } yield {
      Json.obj(
        "modified" -> annotation.modified,
        "state" -> annotation.state,
        "id" -> annotation.id,
        "name" -> annotation.name,
        "description" -> annotation.description,
        "typ" -> annotation.typ,
        "task" -> taskJson,
        "stats" -> annotation.statistics,
        "restrictions" -> restrictionsJs,
        "formattedHash" -> Formatter.formatHash(annotation._id.toString),
        "tracing" -> Json.obj("skeleton" -> annotation.skeletonTracingId, "volume" -> annotation.volumeTracingId),
        "dataSetName" -> dataSet.name,
        "organization" -> organization.name,
        "dataStore" -> dataStoreJs,
        "tracingStore" -> tracingStoreJs,
        "visibility" -> annotation.visibility,
        "settings" -> settings,
        "tracingTime" -> annotation.tracingTime,
        "tags" -> (annotation.tags ++ Set(dataSet.name, annotation.tracingType.toString)),
        "user" -> userJson,
        "meshes" -> meshesJs
      )
    }
  }

  //for Explorative Annotations list
  def compactWrites(annotation: Annotation)(implicit ctx: DBAccessContext): Fox[JsObject] =
    for {
      dataSet <- dataSetDAO.findOne(annotation._dataSet)(GlobalAccessContext) ?~> "dataSet.notFoundForAnnotation"
      organization <- organizationDAO.findOne(dataSet._organization)(GlobalAccessContext) ?~> "organization.notFound"
      user <- userDAO.findOne(annotation._user)(GlobalAccessContext) ?~> "user.notFound"
    } yield {
      Json.obj(
        "modified" -> annotation.modified,
        "state" -> annotation.state,
        "id" -> annotation._id.toString,
        "name" -> annotation.name,
        "description" -> annotation.description,
        "typ" -> annotation.typ,
        "stats" -> annotation.statistics,
        "formattedHash" -> Formatter.formatHash(annotation._id.toString),
        "tracing" -> Json.obj("skeleton" -> annotation.skeletonTracingId, "volume" -> annotation.volumeTracingId),
        "dataSetName" -> dataSet.name,
        "organization" -> organization.name,
        "visibility" -> annotation.visibility,
        "tracingTime" -> annotation.tracingTime,
        "tags" -> (annotation.tags ++ Set(dataSet.name, annotation.tracingType.toString)),
        "owner" -> s"${user.firstName} ${user.lastName}"
      )
    }
}
