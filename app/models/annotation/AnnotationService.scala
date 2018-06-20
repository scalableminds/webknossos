package models.annotation

import java.io.{BufferedOutputStream, FileOutputStream}

import com.scalableminds.util.geometry.{BoundingBox, Point3D, Scale, Vector3D}
import com.scalableminds.util.io.{NamedEnumeratorStream, ZipIO}
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{BoxImplicits, Fox, FoxImplicits, TextUtils}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{Color, SkeletonTracing, SkeletonTracings, Tree}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.models.datasource.{DataSourceLike => DataSource, SegmentationLayerLike => SegmentationLayer}
import com.scalableminds.webknossos.datastore.tracings._
import com.scalableminds.webknossos.datastore.tracings.skeleton.{NodeDefaults, SkeletonTracingDefaults}
import com.scalableminds.webknossos.datastore.tracings.volume.VolumeTracingDefaults
import com.typesafe.scalalogging.LazyLogging
import models.annotation.AnnotationState._
import models.annotation.AnnotationType._
import models.annotation.handler.SavedTracingInformationHandler
import models.annotation.nml.NmlWriter
import models.binary.{DataSet, DataSetDAO, DataStoreHandlingStrategy}
import models.task.TaskSQL
import models.team.OrganizationSQLDAO
import models.user.User
import utils.ObjectId
import play.api.i18n.Messages
import play.api.Play.current
import play.api.i18n.Messages.Implicits._

import scala.concurrent.Future
import scala.collection.{IterableLike, TraversableLike}
import scala.runtime.Tuple3Zipped
import scala.collection.generic.Growable
import net.liftweb.common.{Box, Full}
import play.api.libs.Files.TemporaryFile
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.iteratee.Enumerator
import reactivemongo.bson.BSONObjectID

object AnnotationService
  extends BoxImplicits
  with FoxImplicits
  with TextUtils
  with ProtoGeometryImplicits
  with LazyLogging {

  private def selectSuitableTeam(user: User, dataSet: DataSet)(implicit ctx: DBAccessContext): Fox[BSONObjectID] = {
    val selectedTeamOpt = dataSet.allowedTeams.intersect(user.teamIds).headOption
    selectedTeamOpt match {
      case Some(selectedTeam) => Fox.successful(selectedTeam)
      case None =>
        for {
          _ <- (user.isTeamManagerInOrg(user.organization) || user.isAdmin)
          organization <- OrganizationSQLDAO.findOneByName(user.organization)
          organizationTeamId <- OrganizationSQLDAO.findOrganizationTeam(organization._id)
          organizationTeamIdBson <- organizationTeamId.toBSONObjectId.toFox
        } yield organizationTeamIdBson
    }
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
    dataSet: DataSet,
    tracingType: TracingType.Value,
    withFallback: Boolean,
    id: String = "")(implicit ctx: DBAccessContext): Fox[Annotation] = {

    def createTracing(dataSource: DataSource) = tracingType match {
      case TracingType.skeleton =>
        dataSet.dataStore.saveSkeletonTracing(SkeletonTracingDefaults.createInstance.copy(dataSetName = dataSet.name, editPosition = dataSource.center))
      case TracingType.volume =>
        dataSet.dataStore.saveVolumeTracing(createVolumeTracing(dataSource, withFallback))
    }
    for {
      dataSource <- dataSet.dataSource.toUsable ?~> "DataSet is not imported."
      tracing <- createTracing(dataSource)
      teamId <- selectSuitableTeam(user, dataSet)
      annotation = Annotation(
        user._id,
        tracing,
        dataSet.name,
        teamId,
        AnnotationSettings.defaultFor(tracingType),
        _id = BSONObjectID.parse(id).getOrElse(BSONObjectID.generate))
      _ <- annotation.saveToDB
    } yield {
      annotation
    }
  }

  def finish(annotation: Annotation)(implicit ctx: DBAccessContext) = {
    // WARNING: needs to be repeatable, might be called multiple times for an annotation
    AnnotationDAO.finish(annotation._id)
  }

  def baseFor(taskId: ObjectId)(implicit ctx: DBAccessContext): Fox[Annotation] =
    (for {
      list <- AnnotationDAO.findByTaskIdAndType(taskId, AnnotationType.TracingBase)
    } yield list.headOption.toFox).flatten

  def annotationsFor(taskId: ObjectId)(implicit ctx: DBAccessContext) =
      AnnotationDAO.findByTaskIdAndType(taskId, AnnotationType.Task)

  def countActiveAnnotationsFor(taskId: ObjectId)(implicit ctx: DBAccessContext) =
    AnnotationDAO.countActiveByTaskIdAndType(taskId, AnnotationType.Task)

  def openTasksFor(user: User)(implicit ctx: DBAccessContext) =
    AnnotationDAO.findActiveAnnotationsFor(user._id, AnnotationType.Task)

  def countOpenNonAdminTasks(user: User)(implicit ctx: DBAccessContext) =
    AnnotationDAO.countActiveAnnotations(user._id, AnnotationType.Task, user.teamManagerTeamIds)

  def findTasksOf(user: User, isFinished: Option[Boolean], limit: Int)(implicit ctx: DBAccessContext) =
    AnnotationDAO.findFor(user._id, isFinished, AnnotationType.Task, limit)

  def findExploratoryOf(user: User, isFinished: Option[Boolean], limit: Int)(implicit ctx: DBAccessContext) = {
    val systemTypes = AnnotationType.Task :: AnnotationType.SystemTracings
    AnnotationDAO.findFor(user._id, isFinished, AnnotationType.Explorational, limit)
  }

  def tracingFromBase(annotationBase: Annotation, dataSet: DataSet)(implicit ctx: DBAccessContext): Fox[TracingReference] = {
    for {
      dataSource <- dataSet.dataSource.toUsable.toFox ?~> "Could not convert to usable DataSource"
      newTracingReference <- dataSet.dataStore.duplicateSkeletonTracing(annotationBase.tracingReference)
    } yield newTracingReference
  }

  def createAnnotationFor(user: User, task: TaskSQL, initializingAnnotationId: ObjectId)(implicit messages: Messages, ctx: DBAccessContext): Fox[Annotation] = {
    def useAsTemplateAndInsert(annotation: Annotation) = {
      for {
        dataSet <- DataSetDAO.findOneBySourceName(annotation.dataSetName) ?~> ("Could not find DataSet " + annotation.dataSetName + ". Does your team have access?")
        newTracing <- tracingFromBase(annotation, dataSet) ?~> "Failed to use annotation base as template."
        newAnnotation = annotation.copy(
          _user = user._id,
          tracingReference = newTracing,
          state = Active,
          typ = AnnotationType.Task,
          _id = initializingAnnotationId.toBSONObjectId.get,
          createdTimestamp = System.currentTimeMillis,
          modifiedTimestamp = System.currentTimeMillis)
        _ <- AnnotationDAO.updateInitialized(newAnnotation)
      } yield {
        newAnnotation
      }
    }

    for {
      annotationBase <- task.annotationBase ?~> "Failed to retrieve annotation base."
      result <- useAsTemplateAndInsert(annotationBase).toFox
    } yield {
      result
    }
  }

  def createTracingBase(dataSetName: String, boundingBox: Option[BoundingBox], startPosition: Point3D, startRotation: Vector3D) = {
    val initialNode = NodeDefaults.createInstance.withId(1).withPosition(startPosition).withRotation(startRotation)
    val initialTree = Tree(1, Seq(initialNode), Seq(), Some(Color(1, 0, 0, 1)), Seq(), Seq(), "", System.currentTimeMillis())
    SkeletonTracingDefaults.createInstance.copy(
      dataSetName = dataSetName,
      boundingBox = boundingBox.flatMap { box => if (box.isEmpty) None else Some(box) },
      editPosition = startPosition,
      editRotation = startRotation,
      activeNodeId = Some(1),
      trees = Seq(initialTree))
  }

  def abortInitializedAnnotationOnFailure(initializingAnnotationId: ObjectId, insertedAnnotationFox: Box[Annotation]) = {
    insertedAnnotationFox match {
      case Full(_) => Fox.successful(())
      case _ => AnnotationSQLDAO.abortInitializingAnnotation(initializingAnnotationId)
    }
  }

  def createAnnotationBase(
    taskFox: Fox[TaskSQL],
    userId: BSONObjectID,
    tracingReferenceBox: Box[TracingReference],
    dataSetName: String,
    description: Option[String]
    )(implicit ctx: DBAccessContext) = {

    for {
      task <- taskFox
      taskType <- task.taskType
      tracingReference <- tracingReferenceBox.toFox
      project <- task.project
      teamIdBson <- project._team.toBSONObjectId.toFox
      taskIdBson <- task._id.toBSONObjectId.toFox
      _ <- Annotation(userId, tracingReference, dataSetName, teamIdBson, taskType.settings,
          typ = AnnotationType.TracingBase, _task = Some(taskIdBson), description = description.getOrElse("")).saveToDB ?~> "Failed to insert annotation."
    } yield true
  }

  def createFrom(
                user: User,
                dataSet: DataSet,
                tracingReference: TracingReference,
                annotationType: AnnotationType,
                settings: AnnotationSettings,
                name: Option[String],
                description: String)(implicit messages: Messages, ctx: DBAccessContext): Fox[Annotation] = {
    for {
      teamId <- selectSuitableTeam(user, dataSet)
      annotation = Annotation(
        user._id,
        tracingReference,
        dataSet.name,
        teamId,
        settings = settings,
        _name = name,
        description = description,
        typ = annotationType)
      _ <- annotation.saveToDB

    } yield annotation
  }

  def logTime(time: Long, _annotation: BSONObjectID)(implicit ctx: DBAccessContext) =
    AnnotationDAO.logTime(time, _annotation)

  def zipAnnotations(annotations: List[Annotation], zipFileName: String)(implicit messages: Messages, ctx: DBAccessContext): Fox[TemporaryFile] = {
    for {
      tracingsNamesAndScalesAsTuples <- getTracingsScalesAndNamesFor(annotations)
      tracingsAndNamesFlattened = flattenTupledLists(tracingsNamesAndScalesAsTuples)
      nmlsAndNames = tracingsAndNamesFlattened.map(tuple => (NmlWriter.toNmlStream(Left(tuple._1), tuple._4, tuple._3), tuple._2))
      zip <- createZip(nmlsAndNames, zipFileName)
    } yield zip
  }

  private def flattenTupledLists[A,B,C,D](tupledLists: List[(List[A], List[B], List[C], List[D])]) = {
    tupledLists.map(tuple => zippedFourLists(tuple._1, tuple._2, tuple._3, tuple._4)).flatten
  }

  private def zippedFourLists[A,B,C,D](l1: List[A], l2: List[B], l3: List[C], l4: List[D]): List[(A, B, C, D)] = {
    ((l1, l2, l3).zipped.toList, l4).zipped.toList.map( tuple => (tuple._1._1, tuple._1._2, tuple._1._3, tuple._2))
  }

  private def getTracingsScalesAndNamesFor(annotations: List[Annotation])(implicit ctx: DBAccessContext): Fox[List[(List[SkeletonTracing], List[String], List[Option[Scale]], List[Annotation])]] = {

    def getTracings(dataSetName: String, tracingReferences: List[TracingReference]) = {
      for {
        dataSet <- DataSetDAO.findOneBySourceName(dataSetName)
        tracingContainers <- Fox.serialCombined(tracingReferences.grouped(1000).toList)(dataSet.dataStore.getSkeletonTracings)
      } yield tracingContainers.flatMap(_.tracings)
    }

    def getDatasetScale(dataSetName: String) = {
      for {
        dataSet <- DataSetDAO.findOneBySourceName(dataSetName)
      } yield dataSet.dataSource.scaleOpt
    }

    def getNames(annotations: List[Annotation]) = Fox.combined(annotations.map(a => SavedTracingInformationHandler.nameForAnnotation(a).toFox))

    val annotationsGrouped: Map[String, List[Annotation]] = annotations.groupBy(_.dataSetName)
    val tracings = annotationsGrouped.map {
      case (dataSetName, annotations) => {
        for {
          scale <- getDatasetScale(dataSetName)
          tracings <- getTracings(dataSetName, annotations.map(_.tracingReference))
          names <- getNames(annotations)
        } yield (tracings, names, annotations.map(a => scale), annotations)
      }
    }
    Fox.combined(tracings.toList)
  }

  private def createZip(nmls: List[(Enumerator[Array[Byte]],String)], zipFileName: String): Future[TemporaryFile] = {
    val zipped = TemporaryFile(normalize(zipFileName), ".zip")
    val zipper = ZipIO.startZip(new BufferedOutputStream(new FileOutputStream(zipped.file)))

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
}
