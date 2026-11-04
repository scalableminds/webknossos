package mail

import com.scalableminds.util.box.Failure
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import org.apache.pekko.actor.ActorSystem

import javax.inject.Inject

/* The only way to hand a mail to the mail actor started in Startup. Only the email services in this package use it,
   the rest of the application calls those services. Sending is fire-and-forget: the actor delivers in the background. */
private[mail] class MailSender @Inject() (actorSystem: ActorSystem) extends LazyLogging {

  private lazy val mailActor = actorSystem.actorSelection("/user/mailActor")

  def send(mail: Mail): Unit = mailActor ! Send(mail)

  /* Runs the lookups an email needs, and the sending, in the background, so that failing to send it never fails the
     action that triggered it. Failures are logged instead. */
  def inBackground(description: String)(sendEmail: => Fox[Unit]): Unit =
    sendEmail.onComplete {
      case f: Failure => logger.warn(s"Could not send email for $description: $f")
      case _          => ()
    }
}
