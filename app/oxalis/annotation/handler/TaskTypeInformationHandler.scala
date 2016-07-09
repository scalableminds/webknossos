package oxalis.annotation.handler

import net.liftweb.common.Box
import models.task.{TaskTypeDAO, TaskType}
import models.annotation.{CompoundAnnotation, AnnotationRestrictions, TemporaryAnnotation}
import models.user.User
import com.scalableminds.util.reactivemongo.DBAccessContext
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.tools.{FoxImplicits, Fox}
import models.team.Role

object TaskTypeInformationHandler extends AnnotationInformationHandler with FoxImplicits {

  import com.scalableminds.util.mvc.BoxImplicits._

  type AType = TemporaryAnnotation

  def taskTypeAnnotationRestrictions(taskType: TaskType) =
    new AnnotationRestrictions {
      override def allowAccess(user: Option[User]) =
        user.flatMap(_.roleInTeam(taskType.team)).contains(Role.Admin)
    }

  def provideAnnotation(taskTypeId: String, user: Option[User])(implicit ctx: DBAccessContext): Fox[TemporaryAnnotation] = {
    for {
      taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> "taskType.notFound"
      annotation <- CompoundAnnotation.createFromTaskType(taskType, user.map(_._id)) ?~> "taskType.noAnnotation"
    } yield {
      annotation.copy(restrictions = taskTypeAnnotationRestrictions(taskType))
    }
  }
}
