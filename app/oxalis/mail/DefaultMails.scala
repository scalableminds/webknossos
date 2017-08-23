package oxalis.mail

import com.scalableminds.util.mail.Mail
import models.user.User
import play.api.i18n.Messages
import views._

object DefaultMails {
  /**
   * Configuration used for settings
   */
  val conf = play.api.Play.current.configuration

  /**
   * Base url used in emails
   */
  val uri = conf.getString("http.uri").getOrElse("http://localhost")

  val defaultFrom = "no-reply@webknossos.org"

  val newUserMailingList = conf.getString("braintracing.newuserlist").getOrElse("")

  val overTimeMailingList = conf.getString("braintracing.overTimeList").getOrElse("")

  val workloadMail = conf.getString("workload.mail").getOrElse("")

  def registerAdminNotifyerMail(user: User, email: String, brainDBResult: String) =
    Mail(
      from = email,
      headers = Map("Sender" -> defaultFrom),
      subject = s"A new user (${user.name}) registered on $uri",
      bodyText = html.mail.registerAdminNotify(user, brainDBResult, uri).body,
      recipients = List(newUserMailingList))

  def overLimitMail(user: User, projectName: String, taskId: Option[String], annotationId: String) =
    Mail(
      from = defaultFrom,
      subject = s"Time limit reached. ${user.abreviatedName} in $projectName",
      bodyText = html.mail.timeLimit(user.name, projectName, taskId.getOrElse(""), annotationId, uri).body,
      recipients = List(overTimeMailingList))

  /**
    * Creates a registration mail which should allow the user to verify his
    * account
    */
  def registerMail(name: String, receiver: String, brainDBresult: String)(implicit messages: Messages) =
    Mail(
      from = defaultFrom,
      subject = "Thanks for your registration on " + uri,
      bodyText = html.mail.register(name, Messages(brainDBresult)).body,
      recipients = List(receiver))

  def activatedMail(name: String, receiver: String) =
    Mail(
      from = defaultFrom,
      subject = s"Your account on $uri got activated",
      bodyText = html.mail.validated(name, uri).body,
      recipients = List(receiver))

  def changePasswordMail(name: String, receiver: String) = {
    Mail(
      from = defaultFrom,
      subject = "Your Oxalis password was changed",
      bodyText = html.mail.passwordChanged(name).body,
      recipients = List(receiver))
  }

  def availableTaskCountMail(tableRows: List[(String, Int, String)]) = {
    Mail(
      from = defaultFrom,
      subject = "Available Tasks Overview",
      bodyHtml = html.mail.availableTaskCounts(tableRows).body,
      recipients = List(workloadMail))
  }
}
