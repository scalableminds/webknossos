package controllers

import javax.inject.Inject

import com.scalableminds.util.reactivemongo.GlobalAccessContext
import com.scalableminds.util.tools.Fox
import models.annotation.{AnnotationDAO, AnnotationService}
import models.mturk.{MTurkAnnotationReference, MTurkAssignment, MTurkAssignmentDAO}
import models.task.Task
import models.user.{User, UserService}
import oxalis.security.Secured
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.mvc.Action

class MTurkController @Inject()(val messagesApi: MessagesApi) extends Controller with Secured {

  /**
    * This is the entry point for amazon turk tracers. The link provided in their description will lead them to this
    * action
    * @param id webknossos generated id to identify the HIT
    * @param workerId identification of the worker (passed from amazon)
    * @param assignmentId amazon identification for the assignment of the worker
    * @return redirection to the tracing page of the task
    */
  def startAssignment(id: String, workerId: String, assignmentId: String) = Action.async {
    implicit request =>

      /**
        * This protects us from creating an annotation twice if a user clicks on the link multiple times.
        *
        * We store the users id and his first created annotation on the mturk assignment and return it if requested
        * again.
        */
      def annotationForAssignment(mturkAssignment: MTurkAssignment, user: User, task: Task) = {
        mturkAssignment.annotations.find(reference => reference._user == user._id) match {
          case Some(reference) =>
            AnnotationDAO.findOneById(reference._annotation)(GlobalAccessContext)
          case None            =>
            for {
              annotation <- AnnotationService.createAnnotationFor(user, task)(GlobalAccessContext)
              _ <- MTurkAssignmentDAO.appendReference(
                mturkAssignment._id,
                MTurkAnnotationReference(annotation._id, user._id, assignmentId))(GlobalAccessContext)
            } yield annotation
        }
      }

      for {
        mturkAssignment <- MTurkAssignmentDAO.findByKey(id)(GlobalAccessContext) ?~> Messages("mturk.assignment.notFound")
        task <- mturkAssignment.task(GlobalAccessContext) ?~> Messages("mturk.task.notFound")
        user <- UserService.prepareMTurkUser(workerId, task.team, task.neededExperience)(GlobalAccessContext) ?~> Messages("mturk.user.notFound")
        annotation <- annotationForAssignment(mturkAssignment, user, task) ?~> Messages("annotation.creationFailed")
      } yield {
        Redirect(routes.AnnotationController.trace(annotation.typ, annotation.id))
        .withSession(Secured.createSession(user))
      }
  }
}
