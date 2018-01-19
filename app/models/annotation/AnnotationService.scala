package models.annotation

import java.io.{BufferedOutputStream, FileOutputStream}

import com.scalableminds.webknossos.datastore.models.datasource.{DataSourceLike => DataSource, SegmentationLayerLike => SegmentationLayer}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{Color, SkeletonTracing, Tree}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.tracings._
import com.scalableminds.webknossos.datastore.tracings.skeleton.{NodeDefaults, SkeletonTracingDefaults}
import com.scalableminds.webknossos.datastore.tracings.volume.VolumeTracingDefaults
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Scale, Vector3D}
import com.scalableminds.util.io.{NamedEnumeratorStream, ZipIO}
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{BoxImplicits, Fox, FoxImplicits, TextUtils}
import com.typesafe.scalalogging.LazyLogging
import models.annotation.AnnotationType._
import models.annotation.handler.SavedTracingInformationHandler
import models.annotation.nml.NmlWriter
import models.binary.{DataSet, DataSetDAO}
import models.task.Task
import models.user.{UsedAnnotationDAO, User}
import net.liftweb.common.Box
import play.api.i18n.Messages
import play.api.libs.Files.TemporaryFile
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.iteratee.Enumerator
import reactivemongo.bson.BSONObjectID

import scala.concurrent.Future
import models.annotation.AnnotationState._

object AnnotationService
  extends BoxImplicits
  with FoxImplicits
  with TextUtils
  with ProtoGeometryImplicits
  with LazyLogging {

  private def selectSuitableTeam(user: User, dataSet: DataSet): BSONObjectID = {
      dataSet.allowedTeams.intersect(user.teamIds).head
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
      annotation = Annotation(
        Some(user._id),
        tracing,
        dataSet.name,
        selectSuitableTeam(user, dataSet),
        AnnotationSettings.defaultFor(tracingType),
        _id = BSONObjectID.parse(id).getOrElse(BSONObjectID.generate))
      _ <- annotation.saveToDB
    } yield {
      annotation
    }
  }

  def updateAllOfTask(
    task: Task,
    settings: AnnotationSettings)(implicit ctx: DBAccessContext) = {
    for {
      _ <- AnnotationDAO.updateSettingsForAllOfTask(task, settings)
    } yield true
  }

  def finish(annotation: Annotation)(implicit ctx: DBAccessContext) = {
    // WARNING: needs to be repeatable, might be called multiple times for an annotation
    AnnotationDAO.finish(annotation._id).map { r =>
      UsedAnnotationDAO.removeAll(AnnotationIdentifier(annotation.typ, annotation.id))
      r
    }
  }

  def baseFor(task: Task)(implicit ctx: DBAccessContext) =
    AnnotationDAO.findByTaskIdAndType(task._id, AnnotationType.TracingBase).one[Annotation].toFox

  def annotationsFor(task: Task)(implicit ctx: DBAccessContext) =
    AnnotationDAO.findByTaskIdAndType(task._id, AnnotationType.Task).cursor[Annotation]().collect[List]()

  def countActiveAnnotationsFor(task: Task)(implicit ctx: DBAccessContext) =
    AnnotationDAO.countActiveByTaskIdsAndType(List(task._id), AnnotationType.Task)

  def freeAnnotationsOfUser(user: User)(implicit ctx: DBAccessContext) = {
    for {
      annotations <- AnnotationDAO.findOpenAnnotationsFor(user._id, AnnotationType.Task)
      _ = annotations.map(annotation => annotation.muta.cancelTask())
      result <- AnnotationDAO.unassignAnnotationsOfUser(user._id)
    } yield result
  }

  def openTasksFor(user: User)(implicit ctx: DBAccessContext) =
    AnnotationDAO.findOpenAnnotationsFor(user._id, AnnotationType.Task)

  def countOpenTasks(user: User)(implicit ctx: DBAccessContext) =
    AnnotationDAO.countOpenAnnotations(user._id, AnnotationType.Task)

  def countOpenNonAdminTasks(user: User)(implicit ctx: DBAccessContext) =
    AnnotationDAO.countOpenAnnotations(user._id, AnnotationType.Task, user.supervisorTeamIds)

  def hasAnOpenTask(user: User)(implicit ctx: DBAccessContext) =
    AnnotationDAO.hasAnOpenAnnotation(user._id, AnnotationType.Task)

  def findTasksOf(user: User, isFinished: Option[Boolean], limit: Int)(implicit ctx: DBAccessContext) =
    AnnotationDAO.findFor(user._id, isFinished, AnnotationType.Task, limit)

  def findExploratoryOf(user: User, isFinished: Option[Boolean], limit: Int)(implicit ctx: DBAccessContext) = {
    val systemTypes = AnnotationType.Task :: AnnotationType.SystemTracings
    AnnotationDAO.findForWithTypeOtherThan(user._id, isFinished, systemTypes, limit)
  }

  def countTaskOf(user: User, _task: BSONObjectID)(implicit ctx: DBAccessContext) =
    AnnotationDAO.countByTaskIdAndUser(user._id, _task, AnnotationType.Task)

  def tracingFromBase(annotationBase: Annotation)(implicit ctx: DBAccessContext): Fox[TracingReference] = {
    for {
      dataSet: DataSet <- DataSetDAO.findOneBySourceName(annotationBase.dataSetName)
      dataSource <- dataSet.dataSource.toUsable.toFox
      newTracingReference <- dataSet.dataStore.duplicateSkeletonTracing(annotationBase.tracingReference)
    } yield newTracingReference
  }

  def createAnnotationFor(user: User, task: Task)(implicit messages: Messages, ctx: DBAccessContext): Fox[Annotation] = {
    def useAsTemplateAndInsert(annotation: Annotation) = {
      for {
        newTracing <- tracingFromBase(annotation) ?~> "Failed to create tracing from base"
        newAnnotation = annotation.copy(
          _user = Some(user._id),
          tracingReference = newTracing,
          state = Active,
          typ = AnnotationType.Task,
          _id = BSONObjectID.generate,
          createdTimestamp = System.currentTimeMillis,
          modifiedTimestamp = System.currentTimeMillis)
        _ <- newAnnotation.saveToDB
      } yield {
        newAnnotation
      }
    }

    for {
      annotationBase <- task.annotationBase ?~> "Failed to retrieve annotation base."
      result <- useAsTemplateAndInsert(annotationBase).toFox ?~> "Failed to use annotation base as template."
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

  def createAnnotationBase(
    taskFox: Fox[Task],
    userId: BSONObjectID,
    tracingReferenceBox: Box[TracingReference],
    dataSetName: String
    )(implicit ctx: DBAccessContext) = {

    for {
      task <- taskFox
      taskType <- task.taskType
      tracingReference <- tracingReferenceBox.toFox
      _ <- Annotation(Some(userId), tracingReference, dataSetName, task._team, taskType.settings,
          typ = AnnotationType.TracingBase, _task = Some(task._id)).saveToDB ?~> "Failed to insert annotation."
    } yield true
  }

  def updateAnnotationBase(task: Task, newTracingRefernce: TracingReference)(implicit ctx: DBAccessContext) = {
    for {
      annotationBase <- task.annotationBase
    } yield {
      AnnotationDAO.updateTracingRefernce(annotationBase._id, newTracingRefernce)
    }
  }

  def createFrom(
                user: User,
                dataSet: DataSet,
                tracingReference: TracingReference,
                annotationType: AnnotationType,
                settings: AnnotationSettings,
                name: Option[String],
                description: String)(implicit messages: Messages, ctx: DBAccessContext): Fox[Annotation] = {
    val annotation = Annotation(
      Some(user._id),
      tracingReference,
      dataSet.name,
      _team = selectSuitableTeam(user, dataSet),
      settings = settings,
      _name = name,
      description = description,
      typ = annotationType)
    for {
      _ <- annotation.saveToDB
    } yield annotation
  }

  def logTime(time: Long, _annotation: BSONObjectID)(implicit ctx: DBAccessContext) =
    AnnotationDAO.logTime(time, _annotation)

  def zipAnnotations(annotations: List[Annotation], zipFileName: String)(implicit messages: Messages, ctx: DBAccessContext): Fox[TemporaryFile] = {
    val tracingsNamesAndScalesAsTuples = getTracingsScalesAndNamesFor(annotations)

    for {
      tracingsAndNamesFlattened: List[(SkeletonTracing, String, Scale)] <- flattenListToListMap(tracingsNamesAndScalesAsTuples)
      nmlsAndNames = tracingsAndNamesFlattened.map(tuple => (NmlWriter.toNmlStream(Left(tuple._1), "", tuple._3), tuple._2))
      zip <- createZip(nmlsAndNames, zipFileName)
    } yield zip
  }

  private def getTracingsScalesAndNamesFor(annotations: List[Annotation])(implicit ctx: DBAccessContext) = {

    def getTracings(dataSetName: String, tracingReferences: List[TracingReference]) = {
      for {
        dataSet <- DataSetDAO.findOneBySourceName(dataSetName)
        tracingsContainer <- dataSet.dataStore.getSkeletonTracings(tracingReferences)
      } yield {
        tracingsContainer.tracings.toList
      }
    }

    def getScales(annotations: List[Annotation]) = {
      val foxes = annotations.map(annotation =>
        for {
          dataSet <- DataSetDAO.findOneBySourceName(annotation.dataSetName)
          dataSource <- dataSet.dataSource.toUsable
        } yield dataSource.scale)
      Fox.combined(foxes)
    }

    def getNames(annotations: List[Annotation]) = Fox.combined(annotations.map(a => SavedTracingInformationHandler.nameForAnnotation(a).toFox))

    val annotationsGrouped: Map[String, List[Annotation]] = annotations.groupBy(_.dataSetName)
    val tracings = annotationsGrouped.map {
      case (dataSetName, annotations) => (getTracings(dataSetName, annotations.map(_.tracingReference)), getNames(annotations), getScales(annotations))
    }
    tracings.toList
  }

  def flattenListToListMap(listToListMap: List[(Fox[List[SkeletonTracing]], Fox[List[String]], Fox[List[Scale]])]):
  Fox[List[(SkeletonTracing, String, Scale)]] = {

    val foxOfListsTuples: List[Fox[List[(SkeletonTracing, String, Scale)]]] =
      listToListMap.map {
        case (tracingListFox, nameListFox, scaleListFox) => {
          for {
            tracingList <- tracingListFox
            nameList <- nameListFox
            scaleList <- scaleListFox
          } yield {
            (tracingList, nameList, scaleList).zipped.toList
          }
        }
      }

    Fox.combined(foxOfListsTuples).map(_.flatten)
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
