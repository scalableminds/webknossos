package models.annotation

import java.io.{BufferedOutputStream, File, FileOutputStream}

import com.scalableminds.util.geometry.{BoundingBox, Point3D, Scale, Vector3D}
import com.scalableminds.util.io.{NamedEnumeratorStream, ZipIO}
import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.tools.{BoxImplicits, Fox, FoxImplicits, TextUtils}
import com.scalableminds.webknossos.datastore.SkeletonTracing._
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.models.datasource.{DataSourceLike => DataSource, SegmentationLayerLike => SegmentationLayer}
import com.scalableminds.webknossos.datastore.tracings._
import com.scalableminds.webknossos.datastore.tracings.skeleton.{NodeDefaults, SkeletonTracingDefaults}
import com.scalableminds.webknossos.datastore.tracings.volume.VolumeTracingDefaults
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.annotation.AnnotationState._
import models.annotation.AnnotationType.AnnotationType
import models.annotation.handler.SavedTracingInformationHandler
import models.annotation.nml.NmlWriter
import models.binary._
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
                                  taskDAO: TaskDAO,
                                  userService: UserService,
                                  dataStoreDAO: DataStoreDAO,
                                  projectDAO: ProjectDAO,
                                  organizationDAO: OrganizationDAO,
                                  annotationRestrictionDefults: AnnotationRestrictionDefults,
                                  nmlWriter: NmlWriter,
                                  temporaryFileCreator: TemporaryFileCreator)
                                 (implicit ec: ExecutionContext)
  extends BoxImplicits
    with FoxImplicits
    with TextUtils
    with ProtoGeometryImplicits
    with LazyLogging {

  private def selectSuitableTeam(user: User, dataSet: DataSet)(implicit ctx: DBAccessContext): Fox[ObjectId] = {
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
  }

  private def createVolumeTracing(dataSource: DataSource, withFallback: Boolean): VolumeTracing = {
    val fallbackLayer = if (withFallback) {
      dataSource.dataLayers.flatMap {
        case layer: SegmentationLayer => Some(layer)
        case _ => None
      }.headOption
    } else None

    VolumeTracing(
      None,
      dataSource.boundingBox,
      System.currentTimeMillis(),
      dataSource.id.name,
      dataSource.center,
      VolumeTracingDefaults.editRotation,
      fallbackLayer.map(layer => elementClassToProto(layer.elementClass)).getOrElse(VolumeTracingDefaults.elementClass),
      fallbackLayer.map(_.name),
      fallbackLayer.map(_.largestSegmentId).getOrElse(VolumeTracingDefaults.largestSegmentId),
      0,
      VolumeTracingDefaults.zoomLevel
    )
  }

  def createExplorationalFor(
                              user: User,
                              _dataSet: ObjectId,
                              tracingType: TracingType.Value,
                              withFallback: Boolean)(implicit ctx: DBAccessContext): Fox[Annotation] = {

    def createTracings(dataSet: DataSet, dataSource: DataSource): Fox[(Option[String], Option[String])] = tracingType match {
      case TracingType.skeleton =>
        for {
          handler <- dataSetService.handlerFor(dataSet)
          skeletonTracingId <- handler.saveSkeletonTracing(SkeletonTracingDefaults.createInstance.copy(dataSetName = dataSet.name, editPosition = dataSource.center))
        } yield (Some(skeletonTracingId), None)
      case TracingType.volume =>
        for {
          handler <- dataSetService.handlerFor(dataSet)
          volumeTracingId <- handler.saveVolumeTracing(createVolumeTracing(dataSource, withFallback))
        } yield (None, Some(volumeTracingId))
      case TracingType.hybrid =>
        for {
          handler <- dataSetService.handlerFor(dataSet)
          skeletonTracingId <- handler.saveSkeletonTracing(SkeletonTracingDefaults.createInstance.copy(dataSetName = dataSet.name, editPosition = dataSource.center))
          volumeTracingId <- handler.saveVolumeTracing(createVolumeTracing(dataSource, withFallback))
        } yield (Some(skeletonTracingId), Some(volumeTracingId))
    }
    for {
      dataSet <- dataSetDAO.findOne(_dataSet)
      dataSource <- dataSetService.dataSourceFor(dataSet)
      usableDataSource <- dataSource.toUsable ?~> "DataSet is not imported."
      tracingIds <- createTracings(dataSet, usableDataSource)
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
  }

  // WARNING: needs to be repeatable, might be called multiple times for an annotation
  def finish(annotation: Annotation, user: User, restrictions: AnnotationRestrictions)(implicit ctx: DBAccessContext): Fox[String] = {
    def executeFinish: Fox[String] = {
      for {
        _ <- annotationDAO.updateState(annotation._id, AnnotationState.Finished)
      } yield {
        if (annotation._task.isEmpty)
          "annotation.finished"
        else
          "task.finished"
      }
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

  def tracingFromBase(annotationBase: Annotation, dataSet: DataSet)(implicit ctx: DBAccessContext, m: MessagesProvider): Fox[String] = {
    for {
      dataSource <- bool2Fox(dataSet.isUsable) ?~> Messages("dataSet.notImported", dataSet.name)
      dataStoreHandler <- dataSetService.handlerFor(dataSet)
      skeletonTracingId <- annotationBase.skeletonTracingId.toFox
      newTracingId <- dataStoreHandler.duplicateSkeletonTracing(skeletonTracingId)
    } yield newTracingId
  }

  def createAnnotationFor(user: User, task: Task, initializingAnnotationId: ObjectId)
                         (implicit m: MessagesProvider, ctx: DBAccessContext): Fox[Annotation] = {
    def useAsTemplateAndInsert(annotation: Annotation) = {
      for {
        dataSetName <- dataSetDAO.getNameById(annotation._dataSet)(GlobalAccessContext) ?~> "dataSet.notFound"
        dataSet <- dataSetDAO.findOne(annotation._dataSet) ?~> ("Could not access DataSet " + dataSetName + ". Does your team have access?")
        newTracingId <- tracingFromBase(annotation, dataSet) ?~> "Failed to use annotation base as template."
        newAnnotation = annotation.copy(
          _id = initializingAnnotationId,
          _user = user._id,
          skeletonTracingId = Some(newTracingId),
          state = Active,
          typ = AnnotationType.Task,
          created = System.currentTimeMillis,
          modified = System.currentTimeMillis)
        _ <- annotationDAO.updateInitialized(newAnnotation)
      } yield {
        newAnnotation
      }
    }

    for {
      annotationBase <- baseForTask(task._id) ?~> "Failed to retrieve annotation base."
      result <- useAsTemplateAndInsert(annotationBase).toFox
    } yield {
      result
    }
  }

  def createTracingBase(dataSetName: String, boundingBox: Option[BoundingBox], startPosition: Point3D, startRotation: Vector3D) = {
    val initialNode = NodeDefaults.createInstance.withId(1).withPosition(startPosition).withRotation(startRotation)
    val initialTree = Tree(
      1,
      Seq(initialNode),
      Seq(),
      Some(Color(1, 0, 0, 1)),
      Seq(BranchPoint(initialNode.id, System.currentTimeMillis())),
      Seq(),
      "",
      System.currentTimeMillis()
    )
    SkeletonTracingDefaults.createInstance.copy(
      dataSetName = dataSetName,
      boundingBox = boundingBox.flatMap { box => if (box.isEmpty) None else Some(box) },
      editPosition = startPosition,
      editRotation = startRotation,
      activeNodeId = Some(1),
      trees = Seq(initialTree))
  }

  def abortInitializedAnnotationOnFailure(initializingAnnotationId: ObjectId, insertedAnnotationBox: Box[Annotation]) = {
    insertedAnnotationBox match {
      case Full(_) => Fox.successful(())
      case _ => annotationDAO.abortInitializingAnnotation(initializingAnnotationId)
    }
  }

  def createAnnotationBase(
                            taskFox: Fox[Task],
                            userId: ObjectId,
                            skeletonTracingIdBox: Box[String],
                            dataSetId: ObjectId,
                            description: Option[String]
                          )(implicit ctx: DBAccessContext) = {

    for {
      task <- taskFox
      taskType <- taskTypeDAO.findOne(task._taskType)(GlobalAccessContext)
      skeletonTracingId <- skeletonTracingIdBox.toFox
      project <- projectDAO.findOne(task._project)
      annotationBase = Annotation(
        ObjectId.generate,
        dataSetId,
        Some(task._id),
        project._team,
        userId,
        Some(skeletonTracingId),
        None,
        description.getOrElse(""),
        typ = AnnotationType.TracingBase)
      _ <- annotationDAO.insertOne(annotationBase)
    } yield true
  }


  def createFrom(
                  user: User,
                  dataSet: DataSet,
                  skeletonTracingId: Option[String],
                  volumeTracingId: Option[String],
                  annotationType: AnnotationType,
                  name: Option[String],
                  description: String)(implicit m: MessagesProvider, ctx: DBAccessContext): Fox[Annotation] = {
    for {
      teamId <- selectSuitableTeam(user, dataSet)
      annotation = Annotation(
        ObjectId.generate,
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
  }

  def zipAnnotations(annotations: List[Annotation], zipFileName: String)
                    (implicit m: MessagesProvider, ctx: DBAccessContext): Fox[TemporaryFile] = {
    for {
      tracingsNamesAndScalesAsTuples <- getTracingsScalesAndNamesFor(annotations)
      tracingsAndNamesFlattened = flattenTupledLists(tracingsNamesAndScalesAsTuples)
      nmlsAndNames = tracingsAndNamesFlattened.map(tuple => (nmlWriter.toNmlStream(Some(tuple._1), None, Some(tuple._4), tuple._3, Some(tuple._5), tuple._6), tuple._2))
      zip <- createZip(nmlsAndNames, zipFileName)
    } yield zip
  }

  private def flattenTupledLists[A,B,C,D,E,F](tupledLists: List[(List[A], List[B], List[C], List[D], List[E], List[F])]) = {
    tupledLists.flatMap(tuple => zippedSixLists(tuple._1, tuple._2, tuple._3, tuple._4, tuple._5, tuple._6))
  }

  private def zippedSixLists[A,B,C,D,E,F](l1: List[A], l2: List[B], l3: List[C], l4: List[D], l5: List[E], l6: List[F]): List[(A, B, C, D, E, F)] = {
    ((((l1, l2, l3).zipped.toList, l4).zipped.toList, l5).zipped.toList, l6).zipped.toList.map {
      tuple => (tuple._1._1._1._1, tuple._1._1._1._2, tuple._1._1._1._3, tuple._1._1._2, tuple._1._2, tuple._2)
    }
  }

  private def getTracingsScalesAndNamesFor(annotations: List[Annotation])(implicit ctx: DBAccessContext):
  Fox[List[(List[SkeletonTracing], List[String], List[Option[Scale]], List[Annotation], List[User], List[Option[Task]])]] = {

    def getTracings(dataSetId: ObjectId, tracingIds: List[String]) = {
      for {
        dataSet <- dataSetDAO.findOne(dataSetId)
        dataStoreHandler <- dataSetService.handlerFor(dataSet)
        tracingContainers <- Fox.serialCombined(tracingIds.grouped(1000).toList)(dataStoreHandler.getSkeletonTracings)
      } yield tracingContainers.flatMap(_.tracings)
    }

    def getUsers(userIds: List[ObjectId]) = {
      Fox.serialCombined(userIds)(userService.findOneById(_, useCache = true))
    }

    def getTasks(taskIds: List[Option[ObjectId]]) = {
      Fox.serialCombined(taskIds)(taskIdOpt => Fox.runOptional(taskIdOpt)(taskDAO.findOne))
    }

    def getDatasetScale(dataSetId: ObjectId) = {
      for {
        dataSet <- dataSetDAO.findOne(dataSetId)
      } yield dataSet.scale
    }

    def getNames(annotations: List[Annotation]) = Fox.combined(annotations.map(a => savedTracingInformationHandler.nameForAnnotation(a).toFox))

    val annotationsGrouped: Map[ObjectId, List[Annotation]] = annotations.groupBy(_._dataSet)
    val tracings = annotationsGrouped.map {
      case (dataSetId, annotations) => {
        for {
          scale <- getDatasetScale(dataSetId)
          tracings <- getTracings(dataSetId, annotations.flatMap(_.skeletonTracingId))
          users <- getUsers(annotations.map(_._user)) ?~> "user.notFound"
          taskOpts <- getTasks(annotations.map(_._task)) ?~> "task.notFound"
          names <- getNames(annotations)
        } yield (tracings, names, annotations.map(a => scale), annotations, users, taskOpts)
      }
    }
    Fox.combined(tracings.toList)
  }

  private def createZip(nmls: List[(Enumerator[Array[Byte]],String)], zipFileName: String): Future[TemporaryFile] = {
    val zipped = temporaryFileCreator.create(normalize(zipFileName), ".zip")
    val zipper = ZipIO.startZip(new BufferedOutputStream(new FileOutputStream(new File(zipped.path.toString))))

    def addToZip(nmls: List[(Enumerator[Array[Byte]],String)]): Future[Boolean] = {
      nmls match {
        case head :: tail =>
          zipper.withFile(head._2 + ".nml")(NamedEnumeratorStream("", head._1).writeTo).flatMap(_ => addToZip(tail))
        case _            =>
          Future.successful(true)
      }
    }

    addToZip(nmls).map { _ =>
      zipper.close()
      zipped
    }
  }

  def transferAnnotationToUser(typ: String, id: String, userId: ObjectId, issuingUser: User)(implicit ctx: DBAccessContext): Fox[Annotation] = {
    for {
      annotation <- annotationInformationProvider.provideAnnotation(typ, id, issuingUser) ?~> "annotation.notFound"
      newUser <- userDAO.findOne(userId) ?~> "user.notFound"
      _ <- dataSetDAO.findOne(annotation._dataSet)(AuthorizedAccessContext(newUser)) ?~> "annotation.transferee.noDataSetAccess"
      _ <- annotationDAO.updateUser(annotation._id, newUser._id)
      updated <- annotationInformationProvider.provideAnnotation(typ, id, issuingUser)
    } yield updated
  }

  def resetToBase(annotation: Annotation)(implicit ctx: DBAccessContext, m: MessagesProvider) = annotation.typ match {
    case AnnotationType.Explorational =>
      Fox.failure("annotation.revert.skeletonOnly")
    case AnnotationType.Task if annotation.skeletonTracingId.isDefined =>
      for {
        task <- taskFor(annotation)
        annotationBase <- baseForTask(task._id)
        dataSet <- dataSetDAO.findOne(annotationBase._dataSet)(GlobalAccessContext) ?~> "dataSet.notFound"
        newTracingId <- tracingFromBase(annotationBase, dataSet)
        _ <- annotationDAO.updateSkeletonTracingId(annotation._id, newTracingId)
      } yield ()
    case _ if !annotation.skeletonTracingId.isDefined =>
      Fox.failure("annotation.revert.skeletonOnly")
  }


  private def settingsFor(annotation: Annotation)(implicit ctx: DBAccessContext) = {
    if (annotation.typ == AnnotationType.Task || annotation.typ == AnnotationType.TracingBase)
      for {
        taskId <- annotation._task.toFox
        task: Task <- taskDAO.findOne(taskId) ?~> "task.notFound"
        taskType <- taskTypeDAO.findOne(task._taskType) ?~> "taskType.notFound"
      } yield {
        taskType.settings
      }
    else
      Fox.successful(AnnotationSettings.defaultFor(annotation.tracingType))
  }

  def taskFor(annotation: Annotation)(implicit ctx: DBAccessContext): Fox[Task] =
    annotation._task.toFox.flatMap(taskId => taskDAO.findOne(taskId)(GlobalAccessContext))

  def composeRestrictionsFor(annotation: Annotation, restrictions: Option[AnnotationRestrictions], readOnly: Option[Boolean]) = {
    if (readOnly.getOrElse(false))
      annotationRestrictionDefults.readonlyAnnotation()
    else
      restrictions.getOrElse(annotationRestrictionDefults.defaultAnnotationRestrictions(annotation))
  }

  def publicWrites(annotation: Annotation, requestingUser: Option[User] = None, restrictions: Option[AnnotationRestrictions] = None, readOnly: Option[Boolean] = None): Fox[JsObject] = {
    implicit val ctx = GlobalAccessContext
    for {
      dataSet <- dataSetDAO.findOne(annotation._dataSet) ?~> "dataSet.notFound"
      task = annotation._task.toFox.flatMap(taskId => taskDAO.findOne(taskId))
      taskJson <- task.flatMap(t => taskService.publicWrites(t)).getOrElse(JsNull)
      user <- userService.findOneById(annotation._user, useCache = true)(GlobalAccessContext)
      userJson <- userService.compactWrites(user)
      settings <- settingsFor(annotation)
      annotationRestrictions <- AnnotationRestrictions.writeAsJson(composeRestrictionsFor(annotation, restrictions, readOnly), requestingUser)
      dataStore <- dataStoreDAO.findOneByName(dataSet._dataStore.trim) ?~> "datastore.notFound"
      dataStoreJs <- dataStoreService.publicWrites(dataStore)
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
        "restrictions" -> annotationRestrictions,
        "formattedHash" -> Formatter.formatHash(annotation._id.toString),
        "tracing" -> Json.obj("skeleton" -> annotation.skeletonTracingId, "volume" -> annotation.volumeTracingId),
        "dataSetName" -> dataSet.name,
        "dataStore" -> dataStoreJs,
        "isPublic" -> annotation.isPublic,
        "settings" -> settings,
        "tracingTime" -> annotation.tracingTime,
        "tags" -> (annotation.tags ++ Set(dataSet.name, annotation.tracingType.toString)),
        "user" -> userJson
      )
    }
  }

  //for Explorative Annotations list
  def compactWrites(annotation: Annotation)(implicit ctx: DBAccessContext): Fox[JsObject] = {
    for {
      dataSet <- dataSetDAO.findOne(annotation._dataSet)(GlobalAccessContext) ?~> "dataSet.notFound"
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
        "isPublic" -> annotation.isPublic,
        "tracingTime" -> annotation.tracingTime,
        "tags" -> (annotation.tags ++ Set(dataSet.name, annotation.tracingType.toString))
      )
    }
  }
}
