package models.annotation.handler

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{Annotation, AnnotationRestrictions}
import models.task.{TaskType, TaskTypeDAO}
import models.team.Role
import models.user.User
import play.api.libs.concurrent.Execution.Implicits._

object TaskTypeInformationHandler extends AnnotationInformationHandler with FoxImplicits {

  def taskTypeAnnotationRestrictions(taskType: TaskType) =
    new AnnotationRestrictions {
      override def allowAccess(user: Option[User]) =
        user.flatMap(_.roleInTeam(taskType.team)).contains(Role.Admin)
    }

  def provideAnnotation(taskTypeId: String, user: Option[User])(implicit ctx: DBAccessContext): Fox[Annotation] = Fox.empty // TODO: rocksDB
//  {
//    for {
//      taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> "taskType.notFound"
//      annotation <- CompoundAnnotation.createFromTaskType(taskType, user.map(_._id)) ?~> "taskType.noAnnotation"
//    } yield {
//      annotation.copy(restrictions = taskTypeAnnotationRestrictions(taskType))
//    }
//  }
}
