package models.annotation.handler

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{Annotation, AnnotationRestrictions}
import models.task.{Task, TaskDAO}
import models.team.Role
import models.user.User
import play.api.libs.concurrent.Execution.Implicits._

object TaskInformationHandler extends AnnotationInformationHandler with FoxImplicits {

  def taskAnnotationRestrictions(task: Task) =
    new AnnotationRestrictions {
      override def allowAccess(user: Option[User]) =
        user.flatMap(_.roleInTeam(task.team)) == Some(Role.Admin)
    }

  def provideAnnotation(taskId: String, user: Option[User])(implicit ctx: DBAccessContext): Fox[Annotation] = Fox.empty // TODO: RocksDB
  /*{
    for {
      task <- TaskDAO.findOneById(taskId) ?~> "task.notFound"
      annotation <- CompoundAnnotation.createFromTask(task, user.map(_._id)) ?~> "task.noAnnotation"
    } yield {
      annotation.copy(restrictions = taskAnnotationRestrictions(task))
    }
  }*/
}
