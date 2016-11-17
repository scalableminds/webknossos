package models.annotation

import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.TimeLogger._
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.AnnotationType._
import models.task.{Task, TaskDAO, TaskType}
import models.tracing.skeleton.temporary.{TemporarySkeletonTracing, TemporarySkeletonTracingService}
import models.tracing.skeleton.{SkeletonTracing, SkeletonTracingLike, SkeletonTracingService}
import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.Logger
import play.api.i18n.Messages
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.bson.BSONObjectID
import scala.concurrent.Future

import models.project.Project

object CompoundAnnotation extends Formatter with FoxImplicits {

  def filterFinishedAnnotations(a: Annotation) =
    a.state.isFinished

  def createFromProject(project: Project, _user: Option[BSONObjectID])(implicit ctx: DBAccessContext) = {
    logTime("project composition", Logger.debug) {
      for {
        tasks <- TaskDAO.findAllByProject(project.name)
        annotations <- Fox.serialSequence(tasks)(_.annotations).map(_.flatten).toFox
        merged <- createFromFinishedAnnotations(
          project.name,
          _user,
          project.team,
          controllers.routes.AnnotationIOController.projectDownload(project.name).url,
          annotations,
          AnnotationType.CompoundProject,
          Some(AnnotationSettings.default)) ?~> "project.noAnnotations"
      } yield merged
    }
  }

  def createFromTask(task: Task, _user: Option[BSONObjectID])(implicit ctx: DBAccessContext) = {
    logTime("task composition", Logger.debug) {
      for {
        annotations <- task.annotations.toFox
        merged <- createFromFinishedAnnotations(
          task.id,
          _user,
          task.team,
          controllers.routes.AnnotationIOController.taskDownload(task.id).url,
          annotations,
          AnnotationType.CompoundTask,
          Some(AnnotationSettings.default)) ?~> "task.noAnnotations"
      } yield merged
    }
  }

  def createFromTaskType(taskType: TaskType, _user: Option[BSONObjectID])(implicit ctx: DBAccessContext) = {
    logTime("taskType composition", Logger.debug) {
      for {
        tasks <- TaskDAO.findAllByTaskType(taskType._id)
        annotations <- Future.traverse(tasks)(_.annotations).map(_.flatten).toFox
        merged <- createFromFinishedAnnotations(
          taskType.id,
          _user,
          taskType.team,
          controllers.routes.AnnotationIOController.taskTypeDownload(taskType.id).url,
          annotations,
          AnnotationType.CompoundTaskType,
          Some(AnnotationSettings.default)) ?~> "taskType.noAnnotations"
      } yield merged
    }
  }


  def createFromFinishedAnnotations(
    id: String,
    _user: Option[BSONObjectID],
    team: String,
    downloadUrl: String,
    annotations: List[Annotation],
    typ: AnnotationType,
    settings: Option[AnnotationSettings])(implicit ctx: DBAccessContext) =

    createFromAnnotations(
      id, _user, team, Some(downloadUrl), annotations.filter(filterFinishedAnnotations),
      typ, AnnotationState.Finished, AnnotationRestrictions.restrictEverything, settings)

  def createFromAnnotations(
    id: String,
    _user: Option[BSONObjectID],
    team: String,
    downloadUrl: Option[String],
    annotations: List[AnnotationLike],
    typ: AnnotationType,
    state: AnnotationState,
    restrictions: AnnotationRestrictions,
    settings: Option[AnnotationSettings])(implicit ctx: DBAccessContext): Fox[TemporaryAnnotation] = {
    def renameAnnotationContents(annotations: List[AnnotationLike], processed: Vector[AnnotationContent] = Vector.empty): Fox[List[AnnotationContent]] = {
      annotations match {
        case annotation :: tail =>

          annotation.content.flatMap{
            case skeleton: SkeletonTracing =>
              SkeletonTracingService.renameTreesOfTracing(skeleton, annotation.user, annotation.task)
            case c =>
              Fox.successful(c)
          }.flatMap { annotationContent =>
            renameAnnotationContents(tail, processed :+ annotationContent)
          }
        case _ =>
          Fox.successful(processed.toList)
      }
    }
    if(annotations.isEmpty)
      Fox.empty
    else
      Fox.successful(TemporaryAnnotation(
        id,
        _user,
        () => renameAnnotationContents(annotations)
              .flatMap(mergeAnnotationContent(_, id, settings)),
        None,
        team,
        downloadUrl,
        state,
        typ,
        restrictions = restrictions
      ))
  }

  private def mergeAnnotationContent(
    annotationContents: List[AnnotationContent],
    id: String,
    settings: Option[AnnotationSettings])(implicit ctx: DBAccessContext): Fox[AnnotationContent] = {

    def merge(list: List[AnnotationContent]): Fox[AnnotationContent] = {
      list match {
        case head :: second :: tail =>
          head.mergeWith(second, settings).flatMap(merged => merge(merged :: tail))
        case head :: Nil =>
          head.temporaryDuplicate(id)
        case Nil =>
          Fox.empty
      }
    }

    merge(annotationContents)
  }
}
