package brainflight.mail

import views._
import models.user.User
import play.api.Play

object DefaultMails {
  /**
   * Configuration used for settings
   */
  val conf = play.api.Play.current.configuration
  
  /**
   * Base url used in emails
   */
  val uri = conf.getString( "http.uri" ) getOrElse ("http://localhost")
  
  /**
   * Creates a registration mail which should allow the user to verify his 
   * account
   */
  def registerMail( name: String, receiver: String ) =
    Mail(
        from = "no-reply@brainflight.net",
        subject = "Thanks for your registration on "+ uri,
        bodyText = html.mail.register( name ).body,
        recipients = List( receiver )
    )
    
  def verifiedMail( name: String, receiver: String ) =
    Mail(
        from = "no-reply@brainflight.net",
        subject = "Your account on "+ uri + "got activated",
        bodyText = html.mail.validated( name ).body,
        recipients = List( receiver )
    )
}