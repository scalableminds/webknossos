package com.scalableminds.util.mail

import javax.mail.internet.InternetAddress
import akka.actor._
import com.typesafe.config.Config
import com.typesafe.scalalogging.LazyLogging
import org.apache.commons.mail._

case class Send(mail: Mail)

/**
  * Wrapper for sending email in Play Framework.
  * based on the Mailer Actor by Justin Long
  * based on the EmailNotifier trait by Aishwarya Singhal
  *
  * make sure to include Apache Commons Mail in dependencies
  * "org.apache.commons" % "commons-mail" % "1.2"
  */
case class MailerConfig(
    enabled: Boolean,
    logToStdout: Boolean,
    smtpHost: String,
    smtpPort: Int,
    smtpTls: Boolean,
    smtpUser: String,
    smtpPass: String,
)

class Mailer(conf: MailerConfig) extends Actor with LazyLogging {

  def receive: Receive = {
    case Send(mail) =>
      send(mail)
  }

  private def send(mail: Mail) =
    if (conf.enabled && mail.recipients.exists(_.trim != "")) {
      if (conf.logToStdout) {
        logger.info(s"Sending mail: $mail")
      } else {
        logger.info("hello?")
      }

      val multiPartMail: MultiPartEmail = createEmail(mail)

      setAddress(mail.from)(multiPartMail.setFrom _)
      if (mail.replyTo.isDefined)
        setAddress(mail.replyTo.get)(multiPartMail.addReplyTo _)
      mail.recipients.foreach(setAddress(_)(multiPartMail.addTo _))
      mail.ccRecipients.foreach(setAddress(_)(multiPartMail.addCc _))
      mail.bccRecipients.foreach(setAddress(_)(multiPartMail.addBcc _))

      multiPartMail.setSubject(mail.subject)
      mail.headers foreach { case (key, value) => multiPartMail.addHeader(key, value) }

      // do the work to prepare sending on SMTP
      multiPartMail.setHostName(conf.smtpHost)
      multiPartMail.setSmtpPort(conf.smtpPort)
      multiPartMail.setStartTLSEnabled(conf.smtpTls)
      multiPartMail.setAuthenticator(new DefaultAuthenticator(conf.smtpUser, conf.smtpPass))
      multiPartMail.setDebug(false)
      multiPartMail.send
    } else {
      ""
    }

  /**
    * Extracts an email address from the given string and passes to the enclosed method.
    */
  private def setAddress(emailAddress: String)(setter: (String, String) => _) {
    if (emailAddress != null) {
      try {
        val iAddress = new InternetAddress(emailAddress)
        val address = iAddress.getAddress
        val name = iAddress.getPersonal

        setter(address, name)
      } catch {
        case _: Exception =>
          setter(emailAddress, null)
      }
    }
  }

  /**
    * Creates an appropriate email object based on the content type.
    */
  private def createEmail(mail: Mail): MultiPartEmail =
    if (mail.bodyHtml == "") {
      val email = new MultiPartEmail()
      email.setCharset(mail.charset)
      email.setMsg(mail.bodyText)
      email
    } else {
      val email = new HtmlEmail()
      email.setCharset(mail.charset)
      email.setHtmlMsg(mail.bodyHtml)
      if (mail.bodyText != "")
        email.setTextMsg(mail.bodyText)
      email
    }

}
