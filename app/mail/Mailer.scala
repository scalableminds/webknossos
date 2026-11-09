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
    smtpCheckServerIdentity: Boolean,
    smtpAuth: Boolean,
    smtpUser: String,
    smtpPass: String
)

class Mailer(conf: MailerConfig) extends Actor with LazyLogging {

  private val smtpTimeoutMillis = 60000
  private val charset = "utf-8"

  private lazy val session: Session = {
    val props = new Properties()
    props.put("mail.transport.protocol", "smtp")
    props.put("mail.smtp.host", conf.smtpHost)
    props.put("mail.smtp.port", conf.smtpPort.toString)
    props.put("mail.smtp.starttls.enable", conf.smtpTls.toString)
    props.put("mail.smtp.auth", conf.smtpAuth.toString)
    props.put("mail.smtp.ssl.protocols", "TLSv1.2")
    props.put("mail.smtp.ssl.checkserveridentity", conf.smtpCheckServerIdentity.toString)
    props.put("mail.smtp.connectiontimeout", smtpTimeoutMillis.toString)
    props.put("mail.smtp.timeout", smtpTimeoutMillis.toString)
    val authenticator: Authenticator =
      if (conf.smtpAuth)
        new Authenticator {
          override def getPasswordAuthentication: PasswordAuthentication =
            new PasswordAuthentication(conf.smtpUser, conf.smtpPass)
        }
      else null
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
      parseAddress(mail.from) match {
        case Some(from) => sendFrom(from, mail)
        case None       => logger.error(s"Mail was not sent due to invalid sender address: ${mail.from}")
      }
    }

  private def sendFrom(from: InternetAddress, mail: Mail): Unit = {
    val message = new MimeMessage(session)
    message.setFrom(from)
    message.setReplyTo(parseAddresses(mail.replyTo))
    message.addRecipients(Message.RecipientType.TO, parseAddresses(mail.recipients))
    message.addRecipients(Message.RecipientType.CC, parseAddresses(mail.ccRecipients))
    message.addRecipients(Message.RecipientType.BCC, parseAddresses(mail.bccRecipients))
    message.setSubject(mail.subject, charset)
    message.setSentDate(new Date())
    setBody(message, mail)

    if (conf.smtpHost.nonEmpty) {
      Transport.send(message)
    } else {
      logger.info("Mail was not sent as no smtp host is configured.")
    }
  }

  private def parseAddress(emailAddress: String): Option[InternetAddress] =
    try {
      val address = new InternetAddress(emailAddress)
      address.validate()
      // Re-encode the display name with UTF-8 instead of the JVM default
      Option(address.getPersonal).foreach(personal => address.setPersonal(personal, charset))
      Some(address)
    } catch {
      case e: Exception =>
        logger.warn(s"Failed to parse email address $emailAddress: $e")
        None
    }

  private def parseAddresses(emailAddresses: List[String]): Array[Address] =
    emailAddresses.flatMap(parseAddress).toArray[Address]

  private def setBody(message: MimeMessage, mail: Mail): Unit =
    if (mail.bodyHtml == "") {
      message.setText(mail.bodyText, charset)
    } else if (mail.bodyText == "") {
      message.setText(mail.bodyHtml, charset, "html")
    } else {
      val textPart = new MimeBodyPart()
      textPart.setText(mail.bodyText, charset)
      val htmlPart = new MimeBodyPart()
      htmlPart.setText(mail.bodyHtml, charset, "html")
      message.setContent(new MimeMultipart("alternative", textPart, htmlPart))
    }

}
