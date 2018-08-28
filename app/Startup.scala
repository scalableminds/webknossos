import akka.actor.Props
import com.newrelic.api.agent.NewRelic
import com.scalableminds.util.mail.{Mailer, MailerConfig}
import com.typesafe.scalalogging.LazyLogging
import controllers.InitialDataService
import javax.inject.Inject
import net.liftweb.common.{Failure, Full}
import play.api._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.concurrent._
import utils.WkConf

import scala.concurrent.Future
import scala.sys.process._

class Startup @Inject()  (app: Application) extends LazyLogging{

  logger.info("Executing Startup")
  startActors(app)

  ensurePostgresDatabase.onComplete { _ =>
    if (WkConf.Application.insertInitialData) {
      InitialDataService.insert.futureBox.map {
        case Full(_) => ()
        case Failure(msg, _, _) => logger.info("No initial data inserted: " + msg)
        case _ => logger.warn("Error while inserting initial data")
      }
    }
  }

  def startActors(app: Application) {
    val mailerConf = MailerConfig(
      WkConf.Mail.enabled,
      WkConf.Mail.Smtp.host,
      WkConf.Mail.Smtp.port,
      WkConf.Mail.Smtp.tls,
      WkConf.Mail.Smtp.user,
      WkConf.Mail.Smtp.pass,
      WkConf.Mail.Subject.prefix
    )
    Akka.system(app).actorOf(
      Props(new Mailer(mailerConf)),
      name = "mailActor")
  }

  def ensurePostgresDatabase = {
    logger.info("Running ensure_db.sh with POSTGRES_URL " + sys.env.get("POSTGRES_URL"))

    val processLogger = ProcessLogger(
      (o: String) => logger.info(o),
      (e: String) => logger.error(e))

    // this script is copied to the stage directory in AssetCompilation
    val result = "./tools/postgres/ensure_db.sh" ! processLogger

    if (result != 0)
      throw new Exception("Could not ensure Postgres database. Is postgres installed?")

    // diffing the actual DB schema against schema.sql:
    logger.info("Running diff_schema.sh tools/postgres/schema.sql DB")
    val errorMessage = new StringBuilder("Database schema does not fit to schema.sql:\n")
    def appendMessage(value: String) = errorMessage.append(value + "\n")
    val schemaDiffResult = "tools/postgres/diff_schema.sh tools/postgres/schema.sql DB" ! ProcessLogger(appendMessage, appendMessage)
    if (schemaDiffResult == 0) {
      logger.info("Schema is up to date.")
    } else {
      logger.error(errorMessage.toString())
      NewRelic.noticeError(errorMessage.toString())
    }

    Future.successful(())
  }

}
