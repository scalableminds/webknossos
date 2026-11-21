package mail

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import models.annotation.Annotation
import models.project.Project
import models.task.{Task, TaskTypeDAO}
import models.user.{MultiUserDAO, User, UserDAO}
import utils.WkConf

import javax.inject.Inject

/* Emails about task work: assigning a task to a user, and annotators exceeding the time limit of a project.
   The emails are assembled and sent in the background, so that failing to send them never fails the actual change. */
class TaskEmailService @Inject() (
    userDAO: UserDAO,
    multiUserDAO: MultiUserDAO,
    taskTypeDAO: TaskTypeDAO,
    defaultMails: DefaultMails,
    mailSender: MailSender,
    conf: WkConf
) {

  implicit private val ctx: DBAccessContext = GlobalAccessContext

  // Enabled by the config flag mail.notificationEmails.manualTaskAssignments. Self-assignments are never announced.
  def sendTaskAssignedEmail(task: Task, project: Project, annotationId: ObjectId, assignee: User, issuer: User): Unit =
    if (conf.Mail.NotificationEmails.manualTaskAssignments && assignee._id != issuer._id && !assignee.isDeactivated)
      mailSender.inBackground(s"task ${task._id} assigned to user ${assignee._id}") {
        for {
          recipient <- multiUserDAO.findOne(assignee._multiUser)
          issuerMultiUser <- multiUserDAO.findOne(issuer._multiUser)
          taskType <- taskTypeDAO.findOne(task._taskType)
        } yield mailSender.send(
          defaultMails
            .taskAssignedMail(recipient, issuerMultiUser.fullName, project.name, taskType.summary, annotationId)
        )
      }

  // Tells the owner of the project that the annotator of the task annotation has just exceeded the project's time limit.
  def sendTimeLimitReachedEmail(annotation: Annotation, task: Task, project: Project): Unit =
    mailSender.inBackground(s"time limit of task ${task._id} reached") {
      for {
        annotator <- userDAO.findOne(annotation._user)
        annotatorMultiUser <- multiUserDAO.findOne(annotator._multiUser)
        projectOwner <- userDAO.findOne(project._owner)
        projectOwnerMultiUser <- multiUserDAO.findOne(projectOwner._multiUser)
      } yield mailSender.send(
        defaultMails.overLimitMail(
          annotatorMultiUser,
          project.name,
          task._id.toString,
          annotation.id,
          projectOwnerMultiUser.email
        )
      )
    }
}
