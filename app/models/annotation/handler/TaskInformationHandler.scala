package models.annotation.handler

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import javax.inject.Inject
import models.annotation._
import models.task.TaskDAO
import models.user.{User, UserService}
import play.api.libs.concurrent.Execution.Implicits._
import models.annotation.AnnotationState._
import models.project.ProjectDAO
import utils.ObjectId

class TaskInformationHandler @Inject()(taskDAO: TaskDAO,
                                       annotationService: AnnotationService,
                                       userService: UserService,
                                       annotationMerger: AnnotationMerger,
                                       projectDAO: ProjectDAO) extends AnnotationInformationHandler with FoxImplicits {

  override def provideAnnotation(taskId: ObjectId, userOpt: Option[User])(implicit ctx: DBAccessContext): Fox[Annotation] =
    for {
      task <- taskDAO.findOne(taskId) ?~> "task.notFound"
      annotations <- annotationService.annotationsFor(task._id)
      finishedAnnotations = annotations.filter(_.state == Finished)
      _ <- assertAllOnSameDataset(finishedAnnotations)
      _ <- assertNonEmpty(finishedAnnotations) ?~> "task.noAnnotations"
      user <- userOpt ?~> "user.notAuthorised"
      project <- projectDAO.findOne(task._project)
      _dataSet = finishedAnnotations.head._dataSet
      mergedAnnotation <- annotationMerger.mergeN(task._id, persistTracing=false, user._id,
        _dataSet, project._team, AnnotationType.CompoundTask, finishedAnnotations) ?~> "annotation.merge.failed.compound"
    } yield mergedAnnotation

  def restrictionsFor(taskId: ObjectId)(implicit ctx: DBAccessContext) =
    for {
      task <- taskDAO.findOne(taskId) ?~> "task.notFound"
      project <- projectDAO.findOne(task._project)
    } yield {
      new AnnotationRestrictions {
        override def allowAccess(userOption: Option[User]): Fox[Boolean] =
          (for {
            user <- userOption.toFox
            allowed <- userService.isTeamManagerOrAdminOf(user, project._team)
          } yield allowed).orElse(Fox.successful(false))
      }
    }
}
