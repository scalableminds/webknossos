package models.annotation

import java.io.{BufferedOutputStream, File, FileOutputStream}

import akka.actor.ActorSystem
import akka.stream.ActorMaterializer
import akka.stream.scaladsl.{Source, StreamConverters}
import akka.util.ByteString
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Scale, Vector3D}
import com.scalableminds.util.io.{NamedEnumeratorStream, ZipIO}
import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.tools.{BoxImplicits, Fox, FoxImplicits, TextUtils}
import com.scalableminds.webknossos.tracingstore.SkeletonTracing._
import com.scalableminds.webknossos.tracingstore.VolumeTracing.{VolumeTracing, VolumeTracingOpt, VolumeTracings}
import com.scalableminds.webknossos.datastore.models.datasource.{
  DataSourceLike => DataSource,
  SegmentationLayerLike => SegmentationLayer
}
import com.scalableminds.webknossos.tracingstore.tracings._
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.{NodeDefaults, SkeletonTracingDefaults}
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeTracingDefaults
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
import models.team.OrganizationDAO
import models.user.{User, UserDAO, UserService}
import utils.ObjectId
import play.api.i18n.{I18nSupport, Messages, MessagesApi, MessagesProvider}

import scala.concurrent.{ExecutionContext, Future}
import net.liftweb.common.{Box, Full}
import play.api.libs.Files.{TemporaryFile, TemporaryFileCreator}
import play.api.libs.iteratee.Enumerator
import play.api.libs.json.{JsNull, JsObject, Json}

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
                                  userService: UserService,
                                  dataStoreDAO: DataStoreDAO,
                                  projectDAO: ProjectDAO,
                                  organizationDAO: OrganizationDAO,
                                  annotationRestrictionDefults: AnnotationRestrictionDefaults,
                                  nmlWriter: NmlWriter,
                                  temporaryFileCreator: TemporaryFileCreator,
                                  meshDAO: MeshDAO,
                                  meshService: MeshService)(implicit ec: ExecutionContext)
    extends BoxImplicits
    with FoxImplicits
    with TextUtils
    with ProtoGeometryImplicits
    with LazyLogging {

  implicit val actorSystem = ActorSystem()
  implicit val materializer = ActorMaterializer()

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
            _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOfOrg(user, user._organization))
            organizationTeamId <- organizationDAO.findOrganizationTeamId(user._organization)
          } yield organizationTeamId
      }
    }).flatten

  private def createVolumeTracing(
      dataSource: DataSource,
      withFallback: Boolean,
      boundingBox: Option[BoundingBox] = None,
      startPosition: Option[Point3D] = None,
      startRotation: Option[Vector3D] = None
  ): VolumeTracing = {
    val fallbackLayer: Option[SegmentationLayer] = if (withFallback) {
      dataSource.dataLayers.flatMap {
        case layer: SegmentationLayer => Some(layer)
        case _                        => None
      }.headOption
    } else None

    VolumeTracing(
      None,
      boundingBoxToProto(boundingBox.getOrElse(dataSource.boundingBox)),
      System.currentTimeMillis(),
      dataSource.id.name,
      point3DToProto(startPosition.getOrElse(dataSource.center)),
      vector3DToProto(startRotation.getOrElse(vector3DFromProto(VolumeTracingDefaults.editRotation))),
      elementClassToProto(fallbackLayer.map(layer => layer.elementClass).getOrElse(VolumeTracingDefaults.elementClass)),
      fallbackLayer.map(_.name),
      fallbackLayer.map(_.largestSegmentId).getOrElse(VolumeTracingDefaults.largestSegmentId),
      0,
      VolumeTracingDefaults.zoomLevel
    )
  }

  def createTracings(dataSet: DataSet, dataSource: DataSource, tracingType: TracingType.Value, withFallback: Boolean)(
      implicit ctx: DBAccessContext): Fox[(Option[String], Option[String])] = tracingType match {
    case TracingType.skeleton =>
      for {
        client <- tracingStoreService.clientFor(dataSet)
        skeletonTracingId <- client.saveSkeletonTracing(
          SkeletonTracingDefaults.createInstance.copy(dataSetName = dataSet.name, editPosition = dataSource.center))
      } yield (Some(skeletonTracingId), None)
    case TracingType.volume =>
      for {
        client <- tracingStoreService.clientFor(dataSet)
        volumeTracingId <- client.saveVolumeTracing(createVolumeTracing(dataSource, withFallback))
      } yield (None, Some(volumeTracingId))
    case TracingType.hybrid =>
      for {
        client <- tracingStoreService.clientFor(dataSet)
        skeletonTracingId <- client.saveSkeletonTracing(
          SkeletonTracingDefaults.createInstance.copy(dataSetName = dataSet.name, editPosition = dataSource.center))
        volumeTracingId <- client.saveVolumeTracing(createVolumeTracing(dataSource, withFallback))
      } yield (Some(skeletonTracingId), Some(volumeTracingId))
  }

  def createExplorationalFor(user: User, _dataSet: ObjectId, tracingType: TracingType.Value, withFallback: Boolean)(
      implicit ctx: DBAccessContext): Fox[Annotation] =
    for {
      dataSet <- dataSetDAO.findOne(_dataSet)
      dataSource <- dataSetService.dataSourceFor(dataSet)
      usableDataSource <- dataSource.toUsable ?~> "DataSet is not imported."
      tracingIds <- createTracings(dataSet, usableDataSource, tracingType, withFallback)
      teamId <- selectSuitableTeam(user, dataSet)
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

  def makeAnnotationHybrid(user: User, annotation: Annotation)(implicit ctx: DBAccessContext) = {
    def createNewTracings(dataSet: DataSet, dataSource: DataSource) = annotation.tracingType match {
      case TracingType.skeleton =>
        createTracings(dataSet, dataSource, TracingType.volume, true).flatMap {
          case (_, Some(volumeId)) => annotationDAO.updateVolumeTracingId(annotation._id, volumeId)
          case _                   => Fox.failure("unexpectedReturn")
        }
      case TracingType.volume =>
        createTracings(dataSet, dataSource, TracingType.skeleton, false).flatMap {
          case (Some(skeletonId), _) => annotationDAO.updateSkeletonTracingId(annotation._id, skeletonId)
          case _                     => Fox.failure("unexpectedReturn")
        }
      case _ => Fox.failure("annotation.makeHybrid.alreadyHybrid")
    }

    for {
      dataSet <- dataSetDAO.findOne(annotation._dataSet)
      dataSource <- dataSetService.dataSourceFor(dataSet).flatMap(_.toUsable)
      _ <- createNewTracings(dataSet, dataSource)
    } yield ()

  }

  // WARNING: needs to be repeatable, might be called multiple times for an annotation
  def finish(annotation: Annotation, user: User, restrictions: AnnotationRestrictions)(
      implicit ctx: DBAccessContext): Fox[String] = {
    def executeFinish: Fox[String] =
      for {
        _ <- annotationDAO.updateState(annotation._id, AnnotationState.Finished)
      } yield {
        if (annotation._task.isEmpty)
          "annotation.finished"
        else
          "task.finished"
      }

    (for {
      allowed <- restrictions.allowFinish(user)
    } yield {
      if (allowed) {
        if (annotation.state == Active)
          executeFinish
        else
          Fox.failure("annotation.notActive")
      } else {
        Fox.failure("annotation.notPossible")
      }
    }).flatten
  }

  def baseForTask(taskId: ObjectId)(implicit ctx: DBAccessContext): Fox[Annotation] =
    (for {
      list <- annotationDAO.findAllByTaskIdAndType(taskId, AnnotationType.TracingBase)
    } yield list.headOption.toFox).flatten

  def annotationsFor(taskId: ObjectId)(implicit ctx: DBAccessContext) =
    annotationDAO.findAllByTaskIdAndType(taskId, AnnotationType.Task)

  def countOpenNonAdminTasks(user: User)(implicit ctx: DBAccessContext) =
    for {
      teamManagerTeamIds <- userService.teamManagerTeamIdsFor(user._id)
      result <- annotationDAO.countActiveAnnotationsFor(user._id, AnnotationType.Task, teamManagerTeamIds)
    } yield result

  def tracingFromBase(annotationBase: Annotation, dataSet: DataSet)(
      implicit ctx: DBAccessContext,
      m: MessagesProvider): Fox[(Option[String], Option[String])] =
    for {
      dataSource <- bool2Fox(dataSet.isUsable) ?~> Messages("dataSet.notImported", dataSet.name)
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
        dataSetName <- dataSetDAO.getNameById(annotation._dataSet)(GlobalAccessContext) ?~> "dataSet.notFound"
        dataSet <- dataSetDAO.findOne(annotation._dataSet) ?~> "dataSet.noAccess"
        (newSkeletonId, newVolumeId) <- tracingFromBase(annotation, dataSet) ?~> "Failed to use annotation base as template."
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

  def createVolumeTracingBase(
      dataSetName: String,
      organizationId: ObjectId,
      boundingBox: Option[BoundingBox],
      startPosition: Point3D,
      startRotation: Vector3D,
      volumeShowFallbackLayer: Boolean)(implicit ctx: DBAccessContext, m: MessagesProvider): Fox[VolumeTracing] =
    for {
      dataSet <- dataSetDAO.findOneByNameAndOrganization(dataSetName, organizationId) ?~> Messages("dataset.notFound",
                                                                                                   dataSetName)
      dataSource <- dataSetService.dataSourceFor(dataSet).flatMap(_.toUsable)
      volumeTracing = createVolumeTracing(
        dataSource,
        withFallback = volumeShowFallbackLayer,
        boundingBox = boundingBox.flatMap { box =>
          if (box.isEmpty) None else Some(box)
        },
        startPosition = Some(startPosition),
        startRotation = Some(startRotation)
      )
    } yield volumeTracing

  def abortInitializedAnnotationOnFailure(initializingAnnotationId: ObjectId, insertedAnnotationBox: Box[Annotation]) =
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
  )(implicit ctx: DBAccessContext) =
    for {
      task <- taskFox
      skeletonIdOpt <- skeletonTracingIdBox.toFox
      volumeIdOpt <- volumeTracingIdBox.toFox
      _ <- bool2Fox(skeletonIdOpt.isDefined || volumeIdOpt.isDefined) ?~> "annotation.needsAtleastOne"
      taskType <- taskTypeDAO.findOne(task._taskType)(GlobalAccessContext)
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
    } yield true

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

  def zipAnnotations(annotations: List[Annotation], zipFileName: String)(implicit m: MessagesProvider,
                                                                         ctx: DBAccessContext): Fox[TemporaryFile] =
    for {
      tracingsNamesAndScalesAsTuples <- getTracingsScalesAndNamesFor(annotations)
      tracingsAndNamesFlattened = flattenTupledLists(tracingsNamesAndScalesAsTuples)
      nmlsAndNames = tracingsAndNamesFlattened.map(
        tuple =>
          (nmlWriter.toNmlStream(tuple._1,
                                 tuple._2,
                                 Some(tuple._6),
                                 tuple._5,
                                 Some(tuple._4 + "_data.zip"),
                                 tuple._9,
                                 Some(tuple._7),
                                 tuple._8),
           tuple._4,
           tuple._3))
      zip <- createZip(nmlsAndNames, zipFileName)
    } yield zip

  private def flattenTupledLists[A, B, C, D, E, F, G, H, I](
      tupledLists: List[(List[A], List[B], List[C], List[D], List[E], List[F], List[G], List[H], List[I])]) =
    tupledLists.flatMap(tuple =>
      zippedEightLists(tuple._1, tuple._2, tuple._3, tuple._4, tuple._5, tuple._6, tuple._7, tuple._8, tuple._9))

  private def zippedEightLists[A, B, C, D, E, F, G, H, I](l1: List[A],
                                                          l2: List[B],
                                                          l3: List[C],
                                                          l4: List[D],
                                                          l5: List[E],
                                                          l6: List[F],
                                                          l7: List[G],
                                                          l8: List[H],
                                                          l9: List[I]): List[(A, B, C, D, E, F, G, H, I)] =
    ((((((((l1, l2).zipped.toList, l3).zipped.toList, l4).zipped.toList, l5).zipped.toList, l6).zipped.toList, l7).zipped.toList,
      l8).zipped.toList,
     l9).zipped.toList.map { tuple: ((((((((A, B), C), D), E), F), G), H), I) =>
      (tuple._1._1._1._1._1._1._1._1,
       tuple._1._1._1._1._1._1._1._2,
       tuple._1._1._1._1._1._1._2,
       tuple._1._1._1._1._1._2,
       tuple._1._1._1._1._2,
       tuple._1._1._1._2,
       tuple._1._1._2,
       tuple._1._2,
       tuple._2)
    }

  private def getTracingsScalesAndNamesFor(annotations: List[Annotation])(implicit ctx: DBAccessContext): Fox[
    List[(List[Option[SkeletonTracing]],
          List[Option[VolumeTracing]],
          List[Option[Source[ByteString, _]]],
          List[String],
          List[Option[Scale]],
          List[Annotation],
          List[User],
          List[Option[Task]],
          List[String])]] = {

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

    def getVolumeDataObjects(dataSetId: ObjectId,
                             tracingIds: List[Option[String]]): Fox[List[Option[Source[ByteString, Any]]]] =
      for {
        dataSet <- dataSetDAO.findOne(dataSetId)
        tracingStoreClient <- tracingStoreService.clientFor(dataSet)
        tracingDataObjects: List[Option[Source[ByteString, Any]]] <- Fox.serialCombined(tracingIds) {
          case Some(tracingId) => tracingStoreClient.getVolumeData(tracingId).map(Some(_))
          case None            => Fox.successful(None)
        }
      } yield tracingDataObjects

    def getUsers(userIds: List[ObjectId]) =
      Fox.serialCombined(userIds)(userService.findOneById(_, useCache = true))

    def getTasks(taskIds: List[Option[ObjectId]]) =
      Fox.serialCombined(taskIds)(taskIdOpt => Fox.runOptional(taskIdOpt)(taskDAO.findOne))

    def getDatasetScale(dataSetId: ObjectId) =
      for {
        dataSet <- dataSetDAO.findOne(dataSetId)
      } yield dataSet.scale

    def getNames(annotations: List[Annotation]) =
      Fox.combined(annotations.map(a => savedTracingInformationHandler.nameForAnnotation(a).toFox))

    def getOrganizationNames(annotations: List[Annotation]) =
      Fox.combined(annotations.map(a => organizationDAO.findOrganizationNameForAnnotation(a._id)))

    val annotationsGrouped: Map[ObjectId, List[Annotation]] = annotations.groupBy(_._dataSet)
    val tracingsGrouped = annotationsGrouped.map {
      case (dataSetId, annotations) =>
        for {
          scale <- getDatasetScale(dataSetId)
          skeletonTracings <- getSkeletonTracings(dataSetId, annotations.map(_.skeletonTracingId))
          volumeTracings <- getVolumeTracings(dataSetId, annotations.map(_.volumeTracingId))
          volumeDataObjects <- getVolumeDataObjects(dataSetId, annotations.map(_.volumeTracingId))
          users <- getUsers(annotations.map(_._user)) ?~> "user.notFound"
          taskOpts <- getTasks(annotations.map(_._task)) ?~> "task.notFound"
          names <- getNames(annotations)
          organizationNames <- getOrganizationNames(annotations)
        } yield
          (skeletonTracings,
           volumeTracings,
           volumeDataObjects,
           names,
           annotations.map(a => scale),
           annotations,
           users,
           taskOpts,
           organizationNames)
    }
    Fox.combined(tracingsGrouped.toList)
  }

  private def createZip(nmls: List[(Enumerator[Array[Byte]], String, Option[Source[ByteString, _]])],
                        zipFileName: String): Future[TemporaryFile] = {
    val zipped = temporaryFileCreator.create(normalize(zipFileName), ".zip")
    val zipper = ZipIO.startZip(new BufferedOutputStream(new FileOutputStream(new File(zipped.path.toString))))

    def addToZip(nmls: List[(Enumerator[Array[Byte]], String, Option[Source[ByteString, _]])]): Future[Boolean] =
      nmls match {
        case head :: tail => {
          val dataEnumeratorOpt: Option[Enumerator[Array[Byte]]] =
            head._3.map(volumeData => Enumerator.fromStream(volumeData.runWith(StreamConverters.asInputStream())))
          val writeVolumeDataResult = dataEnumeratorOpt match {
            case Some(dataEnumerator) =>
              zipper.withFile(head._2 + "_data.zip")(NamedEnumeratorStream("", dataEnumerator).writeTo)
            case None => Future.successful(())
          }
          writeVolumeDataResult
            .flatMap(_ => zipper.withFile(head._2 + ".nml")(NamedEnumeratorStream("", head._1).writeTo))
            .flatMap(_ => addToZip(tail))
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

  def resetToBase(annotation: Annotation)(implicit ctx: DBAccessContext, m: MessagesProvider) = annotation.typ match {
    case AnnotationType.Explorational =>
      Fox.failure("annotation.revert.skeletonOnly")
    case AnnotationType.Task if annotation.skeletonTracingId.isDefined =>
      for {
        task <- taskFor(annotation)
        annotationBase <- baseForTask(task._id)
        dataSet <- dataSetDAO.findOne(annotationBase._dataSet)(GlobalAccessContext) ?~> "dataSet.notFound"
        (newSkeletonIdOpt, newVolumeIdOpt) <- tracingFromBase(annotationBase, dataSet)
        _ <- Fox
          .bool2Fox(newSkeletonIdOpt.isDefined || newVolumeIdOpt.isDefined) ?~> "annotation.needsEitherSkeletonOrVolume"
        _ <- Fox.runOptional(newSkeletonIdOpt)(newSkeletonId =>
          annotationDAO.updateSkeletonTracingId(annotation._id, newSkeletonId))
        _ <- Fox.runOptional(newVolumeIdOpt)(newVolumeId =>
          annotationDAO.updateVolumeTracingId(annotation._id, newVolumeId))
      } yield ()
    case _ if !annotation.skeletonTracingId.isDefined =>
      Fox.failure("annotation.revert.skeletonOnly")
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
    implicit val ctx = GlobalAccessContext
    for {
      dataSet <- dataSetDAO.findOne(annotation._dataSet) ?~> "dataSet.notFound"
      organization <- organizationDAO.findOne(dataSet._organization) ?~> "organization.notFound"
      task = annotation._task.toFox.flatMap(taskId => taskDAO.findOne(taskId))
      taskJson <- task.flatMap(t => taskService.publicWrites(t)).getOrElse(JsNull)
      user <- userService.findOneById(annotation._user, useCache = true)(GlobalAccessContext)
      userJson <- userService.compactWrites(user)
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
        "isPublic" -> annotation.isPublic,
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
      dataSet <- dataSetDAO.findOne(annotation._dataSet)(GlobalAccessContext) ?~> "dataSet.notFound"
      organization <- organizationDAO.findOne(dataSet._organization)(GlobalAccessContext) ?~> "organization.notFound"
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
        "isPublic" -> annotation.isPublic,
        "tracingTime" -> annotation.tracingTime,
        "tags" -> (annotation.tags ++ Set(dataSet.name, annotation.tracingType.toString))
      )
    }
}
