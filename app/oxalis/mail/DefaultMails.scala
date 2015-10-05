package oxalis.mail

import views._
import models.user.User
import play.api.Play
import play.api.i18n.Messages
import com.scalableminds.util.mail.Mail

object DefaultMails {
  /**
   * Configuration used for settings
   */
  val conf = play.api.Play.current.configuration

  /**
   * Base url used in emails
   */
  val uri = conf.getString("http.uri") getOrElse ("http://localhost")

  val defaultFrom = "no-reply@webknossos.org"

  val brainTracingMailingList = conf.getString("braintracing.mailinglist") getOrElse ("")
  val newUserMailingList = conf.getString("braintracing.newuserlist") getOrElse ("")
  val supportMail = conf.getString("scm.support.mail") getOrElse ("support@scm.io")

  val workloadMail = conf.getString("workload.mail") getOrElse ("")

  /**
   * Creates a registration mail which should allow the user to verify his
   * account
   */
  def registerAdminNotifyerMail(name: String, email: String, brainDBResult: String) =
    Mail(
      from = email,
      headers = Map("Sender" -> defaultFrom),
      subject = "A new user (" + name + ") registered on oxalis.at",
      bodyText = html.mail.registerAdminNotify(name, brainDBResult).body,
      recipients = List(newUserMailingList))

  def registerMail(name: String, receiver: String, brainDBresult: String) =
    Mail(
      from = defaultFrom,
      subject = "Thanks for your registration on " + uri,
      bodyText = html.mail.register(name, Messages(brainDBresult)).body,
      recipients = List(receiver))

  def verifiedMail(name: String, receiver: String) =
    Mail(
      from = defaultFrom,
      subject = "Your account on " + uri + "got activated",
      bodyText = html.mail.validated(name).body,
      recipients = List(receiver))

  def issueMail(userName: String, email: String, summary: String, description: String) =
    Mail(
      from = email,
      headers = Map("Sender" -> defaultFrom),
      subject = "Non technical issue - " + summary,
      bodyText = html.mail.nonTechnicalIssue(userName, email, description).body,
      recipients = List(brainTracingMailingList),
      replyTo = Some(email),
      ccRecipients = List(supportMail, email))

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
