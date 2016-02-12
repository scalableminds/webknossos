package models.annotation

import java.io.{FileOutputStream, BufferedOutputStream}

import com.scalableminds.util.io.ZipIO
import models.user.User
import com.scalableminds.util.reactivemongo.DBAccessContext
import net.liftweb.common.Full
import oxalis.security.AuthenticatedRequest
import play.api.Logger
import play.api.libs.Files.TemporaryFile
import play.api.libs.json.Json
import scala.collection.mutable.ListBuffer
import scala.concurrent.Future
import com.scalableminds.util.tools.{TextUtils, FoxImplicits, Fox}
import models.tracing.skeleton.SkeletonTracingService
import play.api.libs.concurrent.Execution.Implicits._
import models.task.{Task, TaskService}
import com.scalableminds.util.geometry.{Point3D, BoundingBox}
import reactivemongo.bson.BSONObjectID
import models.annotation.AnnotationType._
import scala.Some
import models.binary.{DataSet, DataSetDAO}
import oxalis.nml.NML
import com.scalableminds.util.mvc.BoxImplicits
import play.modules.reactivemongo.json.BSONFormats._
import play.api.i18n.{Messages, MessagesApi}

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 07.11.13
 * Time: 12:39
 */

object AnnotationService extends AnnotationContentProviders with BoxImplicits with FoxImplicits with TextUtils{

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


  def baseFor(task: Task)(implicit ctx: DBAccessContext) =
    AnnotationDAO.findByTaskIdAndType(task._id, AnnotationType.TracingBase).one[Annotation].toFox

  def annotationsFor(task: Task)(implicit ctx: DBAccessContext) =
    AnnotationDAO.findByTaskIdAndType(task._id, AnnotationType.Task).cursor[Annotation].collect[List]()

  def countUnfinishedAnnotationsFor(task: Task)(implicit ctx: DBAccessContext) =
    AnnotationDAO.countUnfinishedByTaskIdAndType(task._id, AnnotationType.Task)

  def freeAnnotationsOfUser(user: User)(implicit ctx: DBAccessContext) = {
    for {
      annotations <- AnnotationDAO.findOpenAnnotationsFor(user._id, AnnotationType.Task)
      _ = annotations.map(annotation => annotation.muta.cancelTask())
      result <- AnnotationDAO.unassignAnnotationsOfUser(user._id)
    } yield result
  }

  def openExplorationalFor(user: User)(implicit ctx: DBAccessContext) =
    AnnotationDAO.findOpenAnnotationsFor(user._id, AnnotationType.Explorational)

  def openTasksFor(user: User)(implicit ctx: DBAccessContext) =
    AnnotationDAO.findOpenAnnotationsFor(user._id, AnnotationType.Task)

  def countOpenTasks(user: User)(implicit ctx: DBAccessContext) =
    AnnotationDAO.countOpenAnnotations(user._id, AnnotationType.Task)

  def hasAnOpenTask(user: User)(implicit ctx: DBAccessContext) =
    AnnotationDAO.hasAnOpenAnnotation(user._id, AnnotationType.Task)

  def findTasksOf(user: User)(implicit ctx: DBAccessContext) =
    AnnotationDAO.findFor(user._id, AnnotationType.Task)

  def findExploratoryOf(user: User, isFinished: Option[Boolean])(implicit ctx: DBAccessContext) =
    AnnotationDAO.findForWithTypeOtherThan(user._id, isFinished, AnnotationType.Task :: AnnotationType.SystemTracings)

  def findFinishedOf(user: User)(implicit ctx: DBAccessContext) =
    AnnotationDAO.findFinishedFor(user._id)


  def createAnnotationFor(user: User, task: Task)(implicit ctx: DBAccessContext): Fox[Annotation] = {
    def useAsTemplateAndInsert(annotation: Annotation) =
      annotation.copy(
        _user = Some(user._id),
        state = AnnotationState.InProgress,
        typ = AnnotationType.Task).temporaryDuplicate(keepId = false).flatMap(_.saveToDB)

    for {
      annotationBase <- task.annotationBase
      _ <- TaskService.assignOnce(task).toFox
      result <- useAsTemplateAndInsert(annotationBase).toFox
    } yield {
      result
    }
  }

  def createAnnotationBase(task: Task, userId: BSONObjectID, boundingBox: Option[BoundingBox], settings: AnnotationSettings, dataSetName: String, start: Point3D)(implicit ctx: DBAccessContext) = {
    for {
      tracing <- SkeletonTracingService.createFrom(dataSetName, start, boundingBox, insertStartAsNode = true, settings)
      content = ContentReference.createFor(tracing)
      _ <- AnnotationDAO.insert(Annotation(Some(userId), content, team = task.team, typ = AnnotationType.TracingBase, _task = Some(task._id)))
    } yield tracing
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
      dataSet <- DataSetDAO.findOneBySourceName(content.dataSetName) ~> Messages("dataSet.notFound")
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
      temporary.created,
      id)

    saveToDB(annotation)
  }

  def merge(readOnly: Boolean, _user: BSONObjectID, team: String, typ: AnnotationType, annotationsLike: AnnotationLike*)(implicit ctx: DBAccessContext): Fox[TemporaryAnnotation] = {
    val restrictions =
      if (readOnly)
        AnnotationRestrictions.readonlyAnnotation()
      else
        AnnotationRestrictions.updateableAnnotation()

    CompoundAnnotation.createFromAnnotations(BSONObjectID.generate.stringify, Some(_user), team, None, annotationsLike.toList, typ, AnnotationState.InProgress, restrictions)
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

  def createAnnotationFrom(user: User, nmls: List[NML], typ: AnnotationType, name: Option[String])(implicit messages: Messages, ctx: DBAccessContext): Fox[Annotation] = {
    SkeletonTracingService.createFrom(nmls, None, AnnotationSettings.skeletonDefault).toFox.flatMap {
      content =>
        AnnotationService.createFrom(
          user,
          content,
          typ,
          name)
    }
  }

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
            case _ =>
              annotationContent(tail)
          }
        case _ =>
          Future.successful(true)
      }
    }

    annotationContent(annotations).map{ _ =>
      zipper.close()
      zipped
    }
  }
}

