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
  val uri = conf.getString("http.uri").getOrElse("http://localhost")

  val defaultFrom = "no-reply@webknossos.org"

  val brainTracingMailingList = conf.getString("braintracing.mailinglist").getOrElse("")
  val newUserMailingList = conf.getString("braintracing.newuserlist").getOrElse("")
  val supportMail = conf.getString("scm.support.mail").getOrElse("support@scm.io")

  val workloadMail = conf.getString("workload.mail").getOrElse("")

  def registerAdminNotifyerMail(user: User, email: String, brainDBResult: String) =
    Mail(
      from = email,
      headers = Map("Sender" -> defaultFrom),
      subject = s"A new user (${user.name}) registered on $uri",
      bodyText = html.mail.registerAdminNotify(user, brainDBResult, uri).body,
      recipients = List(newUserMailingList))

  def slowUserAdminNotifyerMail(user: User, roundTripTime: Double, bandwidth: Double, avgBitDepth: Double, avgMoveValue: Double, tracingSpeed: Double) =
    Mail(
      from = defaultFrom,
      headers = Map("Sender" -> defaultFrom),
      subject = s"Slow user detected: (${user.name}) on $uri",
      bodyText = s"Dear admin,\n a slow user has been detected: (${user.name}) on $uri\nroundTripTime: ${roundTripTime}\nbandwidth: ${bandwidth}\naverage BitDepth: ${avgBitDepth}\navg move value: ${avgMoveValue}\ntracingSpeed: ${tracingSpeed}\n",
      recipients = List(newUserMailingList))

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
