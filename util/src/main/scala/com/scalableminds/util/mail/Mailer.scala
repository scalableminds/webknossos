/*
* Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.util.mail

import javax.mail.internet.InternetAddress

import akka.actor._
import com.typesafe.config.Config
import org.apache.commons.mail._

case class Send(mail: Mail)

/**
 * this class providers a wrapper for sending email in Play! 2.0
 * based on the EmailNotifier trait by Aishwarya Singhal
 *
 * @author Justin Long
 *
 * make sure to include Apache Commons Mail in dependencies
 * "org.apache.commons" % "commons-mail" % "1.2"
 */

object Mailer {


}

class Mailer(conf: Config) extends Actor {

  val enabled = conf.getBoolean("mail.enabled")
  val smtpHost = conf.getString("mail.smtp.host")
  val smtpPort = conf.getInt("mail.smtp.port")
  val smtpTls = conf.getBoolean("mail.smtp.tls")
  val smtpUser = conf.getString("mail.smtp.user")
  val smtpPass = conf.getString("mail.smtp.pass")
  val subjectPrefix = conf.getString("mail.subject.prefix")

  def receive = {
    case Send(mail) =>
      send(mail)
  }

  /**
   * Sends an email based on the provided data. It also validates and ensures completeness of
   * this object before attempting a send.
   * @return
   */
  def send(mail: Mail) = {
    if (enabled && mail.recipients.exists(_.trim != "")) {
      val multiPartMail: MultiPartEmail = createEmail(mail)

      setAddress(mail.from)(multiPartMail.setFrom _)
      if (mail.replyTo.isDefined)
        setAddress(mail.replyTo.get)(multiPartMail.addReplyTo _)
      mail.recipients.foreach(setAddress(_)(multiPartMail.addTo _))
      mail.ccRecipients.foreach(setAddress(_)(multiPartMail.addCc _))
      mail.bccRecipients.foreach(setAddress(_)(multiPartMail.addBcc _))

      multiPartMail.setSubject(subjectPrefix + mail.subject)
      mail.headers foreach { case (key, value) => multiPartMail.addHeader(key, value) }

      // do the work to prepare sending on SMTP
      multiPartMail.setHostName(smtpHost)
      multiPartMail.setSmtpPort(smtpPort)
      multiPartMail.setTLS(smtpTls)
      multiPartMail.setAuthenticator(new DefaultAuthenticator(smtpUser, smtpPass))
      multiPartMail.setDebug(false)
      multiPartMail.send
    } else {
      ""
    }
  }

  /**
   * Extracts an email address from the given string and passes to the enclosed method.
   *
   * @param emailAddress
   * @param setter
   */
  private def setAddress(emailAddress: String)(setter: (String, String) => _) {
    if (emailAddress != null) {
      try {
        val iAddress = new InternetAddress(emailAddress)
        val address = iAddress.getAddress()
        val name = iAddress.getPersonal()

        setter(address, name)
      } catch {
        case e: Exception =>
          setter(emailAddress, null)
      }
    }
  }

  /**
   * Creates an appropriate email object based on the content type.
   * @return
   */
  private def createEmail(mail: Mail): MultiPartEmail = {
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

  /**
   * Sets a content type if none is defined.
   */
  private def guessContentType(mail: Mail) =
    if (mail.bodyHtml != "") "text/html" else "text/plain"

}
