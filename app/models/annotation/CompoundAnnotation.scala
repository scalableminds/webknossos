package models.annotation

import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.TimeLogger._
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.AnnotationType._
import models.task.{Project, Task, TaskDAO, TaskType}
import models.tracing.skeleton.temporary.{TemporarySkeletonTracing, TemporarySkeletonTracingService}
import models.tracing.skeleton.{SkeletonTracingService, SkeletonTracing, SkeletonTracingLike}
import net.liftweb.common.{Empty, Box, Full, Failure}
import play.api.Logger
import play.api.i18n.Messages
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.bson.BSONObjectID

import scala.concurrent.Future

object CompoundAnnotation extends Formatter with FoxImplicits {

  def filterFinishedAnnotations(a: Annotation) =
    a.state.isFinished

  def createFromProject(project: Project, _user: Option[BSONObjectID])(implicit ctx: DBAccessContext) = {
    logTime("project composition", Logger.debug) {
      for {
        tasks <- TaskDAO.findAllByProject(project.name)
        annotations <- Future.traverse(tasks)(_.annotations).map(_.flatten).toFox
        merged <- createFromFinishedAnnotations(
          project.name,
          _user,
          project.team,
          controllers.admin.routes.NMLIO.projectDownload(project.name).url,
          annotations,
          AnnotationType.CompoundProject) ?~> Messages("project.noAnnotaton")
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
          controllers.admin.routes.NMLIO.taskDownload(task.id).url,
          annotations,
          AnnotationType.CompoundTask) ?~> Messages("task.noAnnotaton")
      } yield merged
    }
  }

  def createFromTaskType(taskType: TaskType, _user: Option[BSONObjectID])(implicit ctx: DBAccessContext) = {
    logTime("taskType composition", Logger.debug) {
      for {
        tasks <- TaskDAO.findAllByTaskType(taskType)
        annotations <- Future.traverse(tasks)(_.annotations).map(_.flatten).toFox
        merged <- createFromFinishedAnnotations(
          taskType.id,
          _user,
          taskType.team,
          controllers.admin.routes.NMLIO.taskTypeDownload(taskType.id).url,
          annotations,
          AnnotationType.CompoundTaskType) ?~> Messages("taskType.noAnnotaton")
      } yield merged
    }
  }


  def createFromFinishedAnnotations(id: String, _user: Option[BSONObjectID], team: String, downloadUrl: String, annotations: List[Annotation], typ: AnnotationType)(implicit ctx: DBAccessContext) =
    createFromAnnotations(id, _user, team, Some(downloadUrl), annotations.filter(filterFinishedAnnotations), typ, AnnotationState.Finished, AnnotationRestrictions.restrictEverything)

  def createFromAnnotations(id: String, _user: Option[BSONObjectID], team: String, downloadUrl: Option[String], annotations: List[AnnotationLike], typ: AnnotationType, state: AnnotationState, restrictions: AnnotationRestrictions)(implicit ctx: DBAccessContext): Fox[TemporaryAnnotation] = {
    def renameAnnotationContents(annotations: List[AnnotationLike], processed: Vector[AnnotationContent]): Fox[List[AnnotationContent]] = {
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
        () => renameAnnotationContents(annotations, Vector.empty).flatMap(mergeAnnotationContent(_, id)),
        None,
        team,
        downloadUrl,
        state,
        typ,
        restrictions = restrictions
      ))
  }

  private def mergeAnnotationContent(annotationContents: List[AnnotationContent], id: String)(implicit ctx: DBAccessContext): Fox[AnnotationContent] = {
    def merge(list: List[AnnotationContent]): Fox[AnnotationContent] = {
      list match {
        case head :: second :: tail =>
          head.mergeWith(second).flatMap(merged => merge(merged :: tail))
        case head :: Nil =>
          head.temporaryDuplicate(id)
        case Nil =>
          Fox.empty
      }
    }

    merge(annotationContents)
  }
}
