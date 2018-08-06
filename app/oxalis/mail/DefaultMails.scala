package oxalis.mail

import com.scalableminds.util.mail.Mail
import models.user.User
import models.team.Organization
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

  val workloadMail = conf.getString("workload.mail").getOrElse("")

  val newOrganizationMailingList = conf.getString("oxalis.newOrganizationMailingList").getOrElse("")

  def registerAdminNotifyerMail(user: User, email: String, brainDBResult: String, organization: Organization) =
    Mail(
      from = email,
      headers = Map("Sender" -> defaultFrom),
      subject = s"A new user (${user.name}) registered on $uri",
      bodyText = html.mail.registerAdminNotify(user, brainDBResult, uri).body,
      recipients = List(organization.newUserMailingList))

  def overLimitMail(user: User, projectName: String, taskId: String, annotationId: String, organization: Organization) =
    Mail(
      from = defaultFrom,
      subject = s"Time limit reached. ${user.abreviatedName} in $projectName",
      bodyText = html.mail.timeLimit(user.name, projectName, taskId, annotationId, uri).body,
      recipients = List(organization.overTimeMailingList))

  def registerMail(name: String, receiver: String, brainDBresult: String)(implicit messages: Messages) =
    Mail(
      from = defaultFrom,
      subject = "Thanks for your registration on " + uri,
      bodyText = html.mail.register(name, Messages(brainDBresult)).body,
      recipients = List(receiver))

  def activatedMail(name: String, receiver: String) =
    Mail(
      from = defaultFrom,
      subject = s"Your account on $uri was activated",
      bodyText = html.mail.validated(name, uri).body,
      recipients = List(receiver))

  def changePasswordMail(name: String, receiver: String) = {
    Mail(
      from = defaultFrom,
      subject = "Your webKnossos password was changed",
      bodyText = html.mail.passwordChanged(name).body,
      recipients = List(receiver))
  }

  def resetPasswordMail(name: String, receiver: String, token: String) = {
    Mail(
      from = defaultFrom,
      subject = "Confirm resetting your webKnossos password",
      bodyText = html.mail.resetPassword(name, uri, token).body,
      recipients = List(receiver))
  }

  def availableTaskCountMail(tableRows: List[(String, Int, String)]) = {
    Mail(
      from = defaultFrom,
      subject = "Available Tasks Overview",
      bodyHtml = html.mail.availableTaskCounts(tableRows).body,
      recipients = List(workloadMail))
  }

  def newOrganizationMail(organizationName: String, creatorEmail: String, domain: String) = {
    Mail(
      from = defaultFrom,
      subject = "New webKnossos Organization created on " + domain,
      bodyHtml = html.mail.newOrganization(organizationName, creatorEmail, domain).body,
      recipients = List(newOrganizationMailingList)
    )
  }
}
