import akka.actor.{ActorSystem, Props}
import com.scalableminds.util.mail.{Mailer, MailerConfig}
import com.typesafe.scalalogging.LazyLogging
import javax.inject._
import utils.WkConfInjected


class Startup @Inject() (actorSystem: ActorSystem, conf: WkConfInjected) extends LazyLogging {

  logger.info("Executing Startup")
  startActors(actorSystem)

  def startActors(actorSystem: ActorSystem) {
    val mailerConf = MailerConfig(
      conf.Mail.enabled,
      conf.Mail.Smtp.host,
      conf.Mail.Smtp.port,
      conf.Mail.Smtp.tls,
      conf.Mail.Smtp.user,
      conf.Mail.Smtp.pass,
      conf.Mail.Subject.prefix
    )
    actorSystem.actorOf(
      Props(new Mailer(mailerConf)),
      name = "mailActor")
  }

}
