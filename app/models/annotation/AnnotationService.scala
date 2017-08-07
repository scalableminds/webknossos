package models.annotation

import java.io.{BufferedOutputStream, FileOutputStream}

import com.scalableminds.braingames.binary.models.datasource.{DataSourceLike => DataSource}
import com.scalableminds.braingames.datastore.tracings.{TracingReference, TracingType}
import com.scalableminds.braingames.datastore.tracings.skeleton.CreateEmptyParameters
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.mvc.BoxImplicits
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits, TextUtils}
import com.typesafe.scalalogging.LazyLogging
import models.annotation.AnnotationType._
import models.binary.DataSet
import models.task.Task
import models.user.{UsedAnnotationDAO, User}
import play.api.i18n.Messages
import play.api.libs.Files.TemporaryFile
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._

import scala.concurrent.Future

/**
  * Company: scalableminds
  * User: tmbo
  * Date: 07.11.13
  * Time: 12:39
  */

object AnnotationService
  extends BoxImplicits
  with FoxImplicits
  with TextUtils
  with LazyLogging{

  private def selectSuitableTeam(user: User, dataSet: DataSet): String = {
    val dataSetTeams = dataSet.owningTeam +: dataSet.allowedTeams
    dataSetTeams.intersect(user.teamNames).head
  }

  def createExplorationalFor(
    user: User,
    dataSet: DataSet,
    tracingType: TracingType.Value,
    id: String = "")(implicit ctx: DBAccessContext): Fox[Annotation] = {

    def createTracing(dataSource: DataSource) = tracingType match {
      case TracingType.skeletonTracing =>
        dataSet.dataStoreInfo.typ.strategy.createEmptySkeletonTracing(dataSet.dataStoreInfo, dataSource, CreateEmptyParameters(dataSource.id.name))
      case TracingType.volumeTracing =>
        dataSet.dataStoreInfo.typ.strategy.createVolumeTracing(dataSet.dataStoreInfo, dataSource)
    }

    for {
      dataSource <- dataSet.dataSource.toUsable ?~> "DataSet is not imported."
      tracing <- createTracing(dataSource)
      annotation = Annotation(
        Some(user._id),
        tracing,
        dataSet.name,
        selectSuitableTeam(user, dataSet),
        AnnotationSettings.default,
        _id = BSONObjectID.parse(id).getOrElse(BSONObjectID.generate))
      _ <- AnnotationDAO.insert(annotation)
    } yield {
      annotation
    }
  }

  def updateAllOfTask(
    task: Task,
    dataSetName: String,
    settings: AnnotationSettings)(implicit ctx: DBAccessContext) = {
    for {
      _ <- AnnotationDAO.updateDataSetNameForAllOfTask(task, dataSetName)
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

  def countUnfinishedAnnotationsFor(task: Task)(implicit ctx: DBAccessContext) =
    AnnotationDAO.countUnfinishedByTaskIdAndType(task._id, AnnotationType.Task)

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

  def createAnnotationFor(user: User, task: Task)(implicit ctx: DBAccessContext): Fox[Annotation] = Fox.empty //TODO: rocksDB
   /*{
    def useAsTemplateAndInsert(annotation: Annotation) =
      annotation.copy(
        _user = Some(user._id),
        state = AnnotationState.InProgress,
        typ = AnnotationType.Task,
        created = System.currentTimeMillis).temporaryDuplicate(keepId = false).flatMap(_.saveToDB)

    for {
      annotationBase <- task.annotationBase ?~> "Failed to retrieve annotation base."
      result <- useAsTemplateAndInsert(annotationBase).toFox ?~> "Failed to use annotation base as template."
    } yield {
      result
    }
  }*/

  def createAnnotationBase(
    task: Task,
    userId: BSONObjectID,
    tracingReference: TracingReference,
    boundingBox: Option[BoundingBox],
    settings: AnnotationSettings,
    dataSetName: String,
    start: Point3D,
    rotation: Vector3D)(implicit ctx: DBAccessContext) = {
    for {
      _ <- AnnotationDAO.insert(
        Annotation(Some(userId), tracingReference, dataSetName, task.team, settings,
          typ = AnnotationType.TracingBase, _task = Some(task._id))) ?~> "Failed to insert annotation."
    } yield true
  }

  //TODO: RocksDB
/*
  def updateAnnotationBase(task: Task, start: Point3D, rotation: Vector3D)(implicit ctx: DBAccessContext) = {

    for {
      base <- task.annotationBase
      content <- base.contentReference
    } yield {
      content.service.updateEditPosRot(start, rotation, content.id)
    }
  }*/

  def createAnnotationBase(
    task: Task,
    userId: BSONObjectID,
    boundingBox: Option[BoundingBox],
    settings: AnnotationSettings)(implicit ctx: DBAccessContext) = {

    //TODO: rocksDB
/*    SkeletonTracingService.createFrom(nml, boundingBox, settings).toFox.flatMap {
      tracing =>
        val content = ContentReference.createFor(tracing)
        AnnotationDAO.insert(Annotation(
          Some(userId), content, team = task.team, typ = AnnotationType.TracingBase, _task = Some(task._id)))
    }*/
    Fox.empty
  }

  def createFrom(
                  user: User,
                  tracingReference: TracingReference,
                  annotationType: AnnotationType,
                  name: Option[String])(implicit messages: Messages, ctx: DBAccessContext): Fox[Nothing] = Fox.empty //TODO: RocksDB
  /* {

    for {
      dataSet <- DataSetDAO.findOneBySourceName(contentReference.dataSetName) ?~> Messages("dataSet.notFound", content.dataSetName)
      annotation = Annotation(
        Some(user._id),
        ContentReference.createFor(content),
        team = selectSuitableTeam(user, dataSet),
        _name = name,
        typ = annotationType)
      _ <- AnnotationDAO.insert(annotation)
    } yield {
      annotation
    }
  }*/

  //TODO: RocksDB
/*  def merge(
    newId: BSONObjectID,
    readOnly: Boolean,
    _user: BSONObjectID,
    team: String,
    typ: AnnotationType,
    annotationsLike: Annotation*)(implicit ctx: DBAccessContext): Fox[TemporaryAnnotation] = {

    val restrictions =
      if (readOnly)
        AnnotationRestrictions.readonlyAnnotation()
      else
        AnnotationRestrictions.updateableAnnotation()

    CompoundAnnotation.createFromAnnotations(
      newId.stringify, Some(_user), team, None,
      annotationsLike.toList, typ, AnnotationState.InProgress, restrictions, None)
  }*/

  def saveToDB(annotation: Annotation)(implicit ctx: DBAccessContext): Fox[Annotation] = {
    AnnotationDAO.update(
      Json.obj("_id" -> annotation._id),
      Json.obj(
        "$set" -> AnnotationDAO.formatWithoutId(annotation),
        "$setOnInsert" -> Json.obj("_id" -> annotation._id)
      ),
      upsert = true).map { _ =>
      annotation
    }
  }

  def createAnnotationFrom(
    user: User,
    additionalFiles: Map[String, TemporaryFile],
    typ: AnnotationType,
    name: Option[String])(implicit messages: Messages, ctx: DBAccessContext): Fox[Annotation] = {

    // TODO: until we implemented workspaces, we need to decide if this annotation is going to be a skeleton or a volume
    // annotation --> hence, this hacky way of making a decision
    def createContent() = {
      //TODO: rocksDB - call datastore create (with nml if applicable - readd nml to this functions parameters?)
      Fox.successful(TracingReference("dummyId", TracingType.skeletonTracing))
    }
    for {
      content <- createContent()
      annotation <- AnnotationService.createFrom(user, content, typ, name) ?~> Messages("annotation.create.fromFailed")
    } yield annotation
  }

  def logTime(time: Long, _annotation: BSONObjectID)(implicit ctx: DBAccessContext) =
    AnnotationDAO.logTime(time, _annotation)

  def zipAnnotations(annotations: List[Annotation], zipFileName: String)(implicit ctx: DBAccessContext) = {
    val zipped = TemporaryFile("annotationZips", normalize(zipFileName))
    val zipper = ZipIO.startZip(new BufferedOutputStream(new FileOutputStream(zipped.file)))

    def annotationContent(annotations: List[Annotation]): Future[Boolean] = {
      // TODO rocksdb
      /*annotations match {
        case head :: tail =>
          head.muta.loadAnnotationContent().futureBox.flatMap {
            case Full(fs) =>
              zipper.withFile(fs.normalizedName)(fs.writeTo).flatMap(_ => annotationContent(tail))
            case x        =>
              logger.warn(s"Failed to retrieve annotation content for zip file ($zipFileName): $x")
              annotationContent(tail)
          }
        case _            =>
          Future.successful(true)
      }*/
      Future.successful(true)
    }

    annotationContent(annotations).map { _ =>
      zipper.close()
      zipped
    }
  }
}
