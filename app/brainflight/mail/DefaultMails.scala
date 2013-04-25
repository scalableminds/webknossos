package brainflight.mail

import views._
import models.user.User
import play.api.Play
import play.api.i18n.Messages

object DefaultMails {
  /**
   * Configuration used for settings
   */
  val conf = play.api.Play.current.configuration

  /**
   * Base url used in emails
   */
  val uri = conf.getString("http.uri") getOrElse ("http://localhost")

  val defaultFrom = "no-reply@oxalis.at"

  val brainTracingMailingList = conf.getString("braintracing.mailinglist") getOrElse ("")
  val supportMail = conf.getString("scm.support.mail") getOrElse ("support@scm.io")
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
      recipients = List("braintracing@neuro.mpg.de"))

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

  def trainingsSuccessMail(name: String, receiver: String, comment: String) =
    Mail(
      from = defaultFrom,
      subject = "Trainings task completed.",
      bodyText = html.mail.trainingsSuccess(name, comment).body,
      recipients = List(receiver))

  def trainingsFailureMail(name: String, receiver: String, comment: String) =
    Mail(
      from = defaultFrom,
      subject = "Please correct your trainings tracing.",
      bodyText = html.mail.trainingsFailure(name, comment).body,
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
}