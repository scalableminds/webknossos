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

  /**
   * Creates a registration mail which should allow the user to verify his
   * account
   */
  def registerMail(name: String, receiver: String, brainDBresult: String) =
    Mail(
      from = "no-reply@oxalis.at",
      subject = "Thanks for your registration on " + uri,
      bodyText = html.mail.register(name, Messages(brainDBresult)).body,
      recipients = List(receiver))

  def verifiedMail(name: String, receiver: String) =
    Mail(
      from = "no-reply@oxalis.at",
      subject = "Your account on " + uri + "got activated",
      bodyText = html.mail.validated(name).body,
      recipients = List(receiver))

  def trainingsSuccessMail(name: String, receiver: String, comment: String) =
    Mail(
      from = "no-reply@oxalis.at",
      subject = "Trainings task completed.",
      bodyText = html.mail.trainingsSuccess(name, comment).body,
      recipients = List(receiver))

  def trainingsFailureMail(name: String, receiver: String, comment: String) =
    Mail(
      from = "no-reply@oxalis.at",
      subject = "Please correct your trainings tracing.",
      bodyText = html.mail.trainingsFailure(name, comment).body,
      recipients = List(receiver))
}