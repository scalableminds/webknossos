package brainflight.mail

import views._
import models.User
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
  def registerMail( name: String, receiver: String, validationKey: String ) =
    Mail(
        from = "no-reply@brainflight.net",
        subject = "Please verify your account on "+ uri,
        bodyText = html.mail.register( 
            name, 
            uri + controllers.routes.UserController.verify( validationKey ).url).body,
        recipients = List( receiver )
    )
}