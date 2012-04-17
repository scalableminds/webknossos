package brainflight.mail

import akka.actor._
import akka.util.duration._
import play.api.libs.json._
import play.api.libs.iteratee._
import play.api.libs.concurrent._
import akka.util.Timeout
import akka.pattern.ask
import play.api.Play.current

import org.apache.commons.mail._

import java.util.concurrent.Future
import java.lang.reflect._
import javax.mail.internet.InternetAddress

import scala.collection.JavaConversions._

import play.api._
import play.api.Configuration._

import views._


case class Send( mail: Mail)

/**
 * this class providers a wrapper for sending email in Play! 2.0
 * based on the EmailNotifier trait by Aishwarya Singhal
 *
 * @author Justin Long
 *
 * make sure to include Apache Commons Mail in dependencies
 * "org.apache.commons" % "commons-mail" % "1.2"
 */

class Mailer extends Actor {

  val conf = play.api.Play.current.configuration
  val smtpHost = conf.getString( "mail.smtp.host" ).get
  val smtpPort = conf.getInt( "mail.smtp.port" ).get
  val smtpSsl = conf.getBoolean( "mail.smtp.ssl" ).get
  val smtpUser = conf.getString( "mail.smtp.user" ).get
  val smtpPass = conf.getString( "mail.smtp.pass" ).get

  def receive = {
    case Send( mail ) =>
      send( mail )
  }

  /**
   * Sends an email based on the provided data. It also validates and ensures completeness of
   * this object before attempting a send.
   *
   * @param bodyText : pass a string or use a Play! text template to generate the template
   *  like view.Mails.templateText(tags).
   * @param bodyHtml : pass a string or use a Play! HTML template to generate the template
   * like view.Mails.templateHtml(tags).
   * @return
   */
  def send( mail: Mail ) = {

    // Content type
    val contentType = mail.contentType getOrElse guessContentType( mail )

    var multiPartMail: MultiPartEmail = createEmail( mail )

    multiPartMail.setCharset( mail.charset )

    setAddress( mail.from ) ( multiPartMail.setFrom _ )
    if( mail.replyTo.isDefined )
      setAddress( mail.replyTo.get ) ( multiPartMail.addReplyTo _ )
    mail.recipients.foreach( setAddress( _ ) ( multiPartMail.addTo _ ))
    mail.ccRecipients.foreach( setAddress( _ ) ( multiPartMail.addCc _ ))
    mail.bccRecipients.foreach( setAddress( _ ) ( multiPartMail.addBcc _ ))

    multiPartMail.setSubject( mail.subject )
    mail.headers foreach { case (key,value) => multiPartMail.addHeader(key, value) }

    // do the work to prepare sending on SMTP
    multiPartMail.setHostName( smtpHost )
    multiPartMail.setSmtpPort( smtpPort )
    multiPartMail.setSSL( smtpSsl )
    multiPartMail.setAuthenticator( new DefaultAuthenticator( smtpUser, smtpPass ) )
    multiPartMail.setDebug( false )

    multiPartMail.send
  }

  /**
   * Extracts an email address from the given string and passes to the enclosed method.
   *
   * @param emailAddress
   * @param setter
   */
  private def setAddress( emailAddress: String )( setter: ( String, String ) => _ ) {
    if ( emailAddress != null ) {
      try {
        val iAddress = new InternetAddress( emailAddress )
        val address = iAddress.getAddress()
        val name = iAddress.getPersonal()

        setter( address, name )
      } catch {
        case e: Exception =>
          setter( emailAddress, null )
      }
    }
  }

  /**
   * Creates an appropriate email object based on the content type.
   *
   * @param bodyText
   * @param bodyHtml
   * @return
   */
  private def createEmail( mail: Mail ): MultiPartEmail = {
    if ( mail.bodyHtml == "" ) {
      val email = new MultiPartEmail()
      email.setMsg( mail.bodyText )
      email
    } else {
      val email = new HtmlEmail().setHtmlMsg( mail.bodyHtml )
      if ( mail.bodyText != "" ) 
        email.setTextMsg( mail.bodyText )
      email
    }
  }

  /**
   * Sets a content type if none is defined.
   *
   * @param bodyHtml
   */
  private def guessContentType( mail: Mail ) =
    if ( mail.bodyHtml != "" ) "text/html" else "text/plain"

}