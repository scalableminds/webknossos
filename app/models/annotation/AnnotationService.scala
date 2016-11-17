package models.annotation

import java.io.{BufferedOutputStream, File, FileOutputStream}

import scala.concurrent.Future

import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.mvc.BoxImplicits
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits, TextUtils}
import models.annotation.AnnotationType._
import models.binary.{DataSet, DataSetDAO}
import models.task.Task
import models.tracing.skeleton.SkeletonTracingService
import models.tracing.volume.VolumeTracingService
import models.user.{UsedAnnotationDAO, User}
import net.liftweb.common.Full
import oxalis.nml.NML
import play.api.i18n.Messages
import play.api.libs.Files.TemporaryFile
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._

/**
  * Company: scalableminds
  * User: tmbo
  * Date: 07.11.13
  * Time: 12:39
  */

object AnnotationService extends AnnotationContentProviders with BoxImplicits with FoxImplicits with TextUtils {

  private def selectSuitableTeam(user: User, dataSet: DataSet): String = {
    val dataSetTeams = dataSet.owningTeam +: dataSet.allowedTeams
    dataSetTeams.intersect(user.teamNames).head
  }

  def createExplorationalFor(user: User, dataSet: DataSet, contentType: String, id: String = "")(implicit ctx: DBAccessContext) =
    withProviderForContentType(contentType) { provider =>
      for {
        content <- provider.createFrom(dataSet)
        contentReference = ContentReference.createFor(content)
        annotation = Annotation(
          Some(user._id),
          contentReference,
          team = selectSuitableTeam(user, dataSet),
          typ = AnnotationType.Explorational,
          state = AnnotationState.InProgress,
          _id = BSONObjectID.parse(id).getOrElse(BSONObjectID.generate)
        )
        _ <- AnnotationDAO.insert(annotation)
      } yield annotation
    }

  def updateAllOfTask(
    task: Task,
    team: String,
    dataSetName: String,
    boundingBox: Option[BoundingBox],
    settings: AnnotationSettings)(implicit ctx: DBAccessContext) = {
    for {
      _ <- AnnotationDAO.updateTeamForAllOfTask(task, team)
      _ <- AnnotationDAO.updateAllOfTask(task, dataSetName, boundingBox, settings)
    } yield true
  }

  def finish(annotation: Annotation)(implicit ctx: DBAccessContext) = {
    // WARNING: needs to be repeatable, might be called multiple times for an annotation
    AnnotationDAO.finish(annotation._id).map { r =>
      annotation.muta.writeAnnotationToFile()
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

  def findExploratoryOf(user: User, isFinished: Option[Boolean], limit: Int)(implicit ctx: DBAccessContext) =
    AnnotationDAO.findForWithTypeOtherThan(user._id, isFinished, AnnotationType.Task :: AnnotationType.SystemTracings, limit)

  def countTaskOf(user: User, _task: BSONObjectID)(implicit ctx: DBAccessContext) =
    AnnotationDAO.countByTaskIdAndUser(user._id, _task, AnnotationType.Task)

  def createAnnotationFor(user: User, task: Task)(implicit ctx: DBAccessContext): Fox[Annotation] = {
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
  }

  def createAnnotationBase(
    task: Task,
    userId: BSONObjectID,
    boundingBox: Option[BoundingBox],
    settings: AnnotationSettings,
    dataSetName: String,
    start: Point3D,
    rotation: Vector3D)(implicit ctx: DBAccessContext) = {

    for {
      tracing <- SkeletonTracingService.createFrom(dataSetName, start, rotation, boundingBox, insertStartAsNode = true, isFirstBranchPoint = true, settings) ?~> "Failed to create skeleton tracing."
      content = ContentReference.createFor(tracing)
      _ <- AnnotationDAO.insert(Annotation(Some(userId), content, team = task.team, typ = AnnotationType.TracingBase, _task = Some(task._id))) ?~> "Failed to insert annotation."
    } yield tracing
  }

  def updateAnnotationBase(task: Task, start: Point3D, rotation: Vector3D)(implicit ctx: DBAccessContext) = {
    for {
      base <- task.annotationBase
      content <- base.content
    } yield {
      content.service.updateEditPosRot(start, rotation, content.id)
    }
  }

  def createAnnotationBase(task: Task, userId: BSONObjectID, boundingBox: Option[BoundingBox], settings: AnnotationSettings, nml: NML)(implicit ctx: DBAccessContext) = {
    SkeletonTracingService.createFrom(nml, boundingBox, settings).toFox.flatMap {
      tracing =>
        val content = ContentReference.createFor(tracing)
        AnnotationDAO.insert(Annotation(Some(userId), content, team = task.team, typ = AnnotationType.TracingBase, _task = Some(task._id)))
    }
  }

  def createFrom(user: User, content: AnnotationContent, annotationType: AnnotationType, name: Option[String])(implicit messages: Messages, ctx: DBAccessContext) = {
    for {
      dataSet <- DataSetDAO.findOneBySourceName(content.dataSetName) ?~> Messages("dataSet.notFound", content.dataSetName)
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
  }

  def createFrom(temporary: TemporaryAnnotation, content: AnnotationContent, id: BSONObjectID)(implicit ctx: DBAccessContext) = {
    val annotation = Annotation(
      temporary._user,
      ContentReference.createFor(content),
      temporary._task,
      temporary.team,
      temporary.state,
      temporary.typ,
      temporary.version,
      temporary._name,
      None,
      temporary.created,
      id)

    saveToDB(annotation)
  }

  def merge(
    newId: BSONObjectID,
    readOnly: Boolean,
    _user: BSONObjectID,
    team: String,
    typ: AnnotationType,
    annotationsLike: AnnotationLike*)(implicit ctx: DBAccessContext): Fox[TemporaryAnnotation] = {

    val restrictions =
      if (readOnly)
        AnnotationRestrictions.readonlyAnnotation()
      else
        AnnotationRestrictions.updateableAnnotation()

    CompoundAnnotation.createFromAnnotations(
      newId.stringify, Some(_user), team, None, annotationsLike.toList, typ, AnnotationState.InProgress, restrictions, None)
  }

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
    nmls: List[NML],
    additionalFiles: Map[String, TemporaryFile],
    typ: AnnotationType,
    name: Option[String])(implicit messages: Messages, ctx: DBAccessContext): Fox[Annotation] = {

    // TODO: until we implemented workspaces, we need to decide if this annotation is going to be a skeleton or a volume
    // annotation --> hence, this hacky way of making a decision
    def createContent() = {
      if (nmls.exists(_.volumes.nonEmpty)) {
        // There is a NML with a volume reference --> volume annotation
        VolumeTracingService.createFrom(nmls, additionalFiles, None, AnnotationSettings.volumeDefault).toFox
      } else {
        // There is no NML with a volume reference --> skeleton annotation
        SkeletonTracingService.createFrom(nmls, None, AnnotationSettings.skeletonDefault).toFox
      }
    }
    for {
      content <- createContent()
      annotation <- AnnotationService.createFrom(user, content, typ, name)
    } yield annotation
  }

  def logTime(time: Long, _annotation: BSONObjectID)(implicit ctx: DBAccessContext) =
    AnnotationDAO.logTime(time, _annotation)

  def zipAnnotations(annotations: List[Annotation], zipFileName: String)(implicit ctx: DBAccessContext) = {
    val zipped = TemporaryFile("annotationZips", normalize(zipFileName))
    val zipper = ZipIO.startZip(new BufferedOutputStream(new FileOutputStream(zipped.file)))

    def annotationContent(annotations: List[Annotation]): Future[Boolean] = {
      annotations match {
        case head :: tail =>
          head.muta.loadAnnotationContent().futureBox.flatMap {
            case Full(fs) =>
              zipper.addFile(fs)
              annotationContent(tail)
            case _        =>
              annotationContent(tail)
          }
        case _            =>
          Future.successful(true)
      }
    }

    annotationContent(annotations).map { _ =>
      zipper.close()
      zipped
    }
  }
}
