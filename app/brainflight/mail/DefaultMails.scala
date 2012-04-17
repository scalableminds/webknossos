package brainflight.mail

import views._
import models.User

object DefaultMails {
  var uri = "http://localhost"
  def registerMail( name: String, receiver: String, validationKey: String ) =
    Mail(
        from = "no-reply@brainflight.net",
        subject = "Please verify your account on "+ uri,
        bodyText = html.mail.register( 
            name, 
            uri+controllers.routes.UserController.verify( validationKey ).url).body,
        recipients = List( receiver )
    )
}