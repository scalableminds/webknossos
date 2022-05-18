package oxalis.mail

import akka.actor.ActorSystem
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.helpers.IntervalScheduler
import javax.inject.Inject
import models.user.{MultiUser, MultiUserDAO}
import play.api.inject.ApplicationLifecycle

import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class MailchimpTicker @Inject()(val lifecycle: ApplicationLifecycle,
                                val system: ActorSystem,
                                multiUserDAO: MultiUserDAO,
                                userDAO: MultiUserDAO,
                                mailchimpClient: MailchimpClient)(implicit ec: ExecutionContext)
    extends IntervalScheduler {

  implicit val ctx: DBAccessContext = GlobalAccessContext

  override protected def tickerInterval: FiniteDuration = 1 hour

  override protected def tick(): Unit = {
    for {
      multiUsers: Seq[MultiUser] <- multiUserDAO.findAll
      _ <- Fox.serialCombined(multiUsers)(tagUserByActivity)
    } yield ()
    ()
  }

  private def tagUserByActivity(multiUser: MultiUser): Fox[Unit] =
    for {
      isActivated <- multiUserDAO.hasAtLeastOneActiveUser(multiUser._id)
      lastActivity <- multiUserDAO.lastActivity(multiUser._id)
      now = System.currentTimeMillis()
      _ = if (isActivated && multiUser.created < now - (21 days).toMillis) {
        if (lastActivity < now - (14 days).toMillis) {
          mailchimpClient.tagMultiUser(multiUser, MailchimpTag.WasActiveInWeeksTwoAndThree)
        } else if (lastActivity > now - (14 days).toMillis) {
          mailchimpClient.tagMultiUser(multiUser, MailchimpTag.WasActiveInWeeksTwoAndThree)
        }
      }
      // TODO exact logic
    } yield ()
}
