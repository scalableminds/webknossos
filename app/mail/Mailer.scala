package mail

import org.apache.pekko.actor.*
import com.typesafe.scalalogging.LazyLogging
import jakarta.mail.{Address, Authenticator, Message, PasswordAuthentication, Session, Transport}
import jakarta.mail.internet.{InternetAddress, MimeBodyPart, MimeMessage, MimeMultipart}

import java.util.{Date, Properties}

case class Send(mail: Mail)

case class MailerConfig(
    logToStdout: Boolean,
    smtpHost: String,
    smtpPort: Int,
    smtpTls: Boolean,
    smtpAuth: Boolean,
    smtpUser: String,
    smtpPass: String
)

class Mailer(conf: MailerConfig) extends Actor with LazyLogging {

  private val smtpTimeoutMillis = 60000

  private lazy val session: Session = {
    val props = new Properties()
    props.put("mail.transport.protocol", "smtp")
    props.put("mail.smtp.host", conf.smtpHost)
    props.put("mail.smtp.port", conf.smtpPort.toString)
    props.put("mail.smtp.starttls.enable", conf.smtpTls.toString)
    props.put("mail.smtp.auth", conf.smtpAuth.toString)
    props.put("mail.smtp.ssl.protocols", "TLSv1.2")
    props.put("mail.smtp.connectiontimeout", smtpTimeoutMillis.toString)
    props.put("mail.smtp.timeout", smtpTimeoutMillis.toString)
    val authenticator =
      if (conf.smtpAuth)
        new Authenticator {
          override def getPasswordAuthentication: PasswordAuthentication =
            new PasswordAuthentication(conf.smtpUser, conf.smtpPass)
        } else null
    Session.getInstance(props, authenticator)
  }

  def receive: Receive = {
    case Send(mail) =>
      send(mail)
    case unknownMessage =>
      logger.warn(s"Mailer received unknown message: $unknownMessage")
  }

  private def send(mail: Mail): Unit =
    if (mail.recipients.exists(_.trim != "")) {
      if (conf.logToStdout) {
        logger.info(s"Sending mail: $mail")
      }

      val message = new MimeMessage(session)
      parseAddress(mail.from).foreach(message.setFrom)
      message.setReplyTo(mail.replyTo.flatMap(parseAddress).toArray[Address])
      addRecipients(message, Message.RecipientType.TO, mail.recipients)
      addRecipients(message, Message.RecipientType.CC, mail.ccRecipients)
      addRecipients(message, Message.RecipientType.BCC, mail.bccRecipients)
      message.setSubject(mail.subject, mail.charset)
      message.setSentDate(new Date())
      mail.headers.foreach { case (key, value) => message.addHeader(key, value) }
      setBody(message, mail)

      if (conf.smtpHost.nonEmpty) {
        Transport.send(message)
      } else {
        logger.info("Mail was not sent as no smtp host is configured.")
      }
    }

  private def parseAddress(emailAddress: String): Option[InternetAddress] =
    try {
      Some(new InternetAddress(emailAddress))
    } catch {
      case e: Exception =>
        logger.warn(s"Failed to set email address: $e")
        None
    }

  private def addRecipients(message: MimeMessage, recipientType: Message.RecipientType, addresses: List[String]): Unit =
    message.addRecipients(recipientType, addresses.flatMap(parseAddress).toArray[Address])

  private def setBody(message: MimeMessage, mail: Mail): Unit =
    if (mail.bodyHtml == "") {
      message.setText(mail.bodyText, mail.charset)
    } else if (mail.bodyText == "") {
      message.setText(mail.bodyHtml, mail.charset, "html")
    } else {
      val textPart = new MimeBodyPart()
      textPart.setText(mail.bodyText, mail.charset)
      val htmlPart = new MimeBodyPart()
      htmlPart.setText(mail.bodyHtml, mail.charset, "html")
      message.setContent(new MimeMultipart("alternative", textPart, htmlPart))
    }

}
