package oxalis.annotation.handler

import net.liftweb.common.Box
import models.task.{TaskDAO, Task}
import play.api.i18n.Messages
import models.user.User
import models.annotation.{CompoundAnnotation, AnnotationRestrictions, TemporaryAnnotation}
import com.scalableminds.util.reactivemongo.DBAccessContext
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.tools.{FoxImplicits, Fox}
import models.team.Role

object TaskInformationHandler extends AnnotationInformationHandler with FoxImplicits {

  import com.scalableminds.util.mvc.BoxImplicits._

  type AType = TemporaryAnnotation

  def taskAnnotationRestrictions(task: Task) =
    new AnnotationRestrictions {
      override def allowAccess(user: Option[User]) =
        user.flatMap(_.roleInTeam(task.team)) == Some(Role.Admin)
    }

  def provideAnnotation(taskId: String, user: Option[User])(implicit ctx: DBAccessContext): Fox[TemporaryAnnotation] = {
    for {
      task <- TaskDAO.findOneById(taskId) ?~> Messages("task.notFound")
      annotation <- CompoundAnnotation.createFromTask(task, user.map(_._id)) ?~> Messages("task.noAnnotations")
    } yield {
      annotation.copy(restrictions = taskAnnotationRestrictions(task))
    }
  }
}
