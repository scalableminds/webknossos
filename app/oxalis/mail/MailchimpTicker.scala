package oxalis.mail

import akka.actor.ActorSystem
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.helpers.IntervalScheduler
import com.typesafe.scalalogging.LazyLogging

import javax.inject.Inject
import models.user.{MultiUser, MultiUserDAO}
import net.liftweb.common.{Empty, Failure, Full}
import play.api.inject.ApplicationLifecycle

import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class MailchimpTicker @Inject()(val lifecycle: ApplicationLifecycle,
                                val system: ActorSystem,
                                multiUserDAO: MultiUserDAO,
                                userDAO: MultiUserDAO,
                                mailchimpClient: MailchimpClient)(implicit ec: ExecutionContext)
    extends IntervalScheduler
    with LazyLogging {

  implicit val ctx: DBAccessContext = GlobalAccessContext

  override protected def tickerInterval: FiniteDuration = 1 hour

  override protected def tick(): Unit = {
    logger.info("Checking if any users need mailchimp tagging...")
    for {
      multiUsers: List[MultiUser] <- multiUserDAO.findAll
      _ = multiUsers.foreach(withErrorLogging(_, tagUserByActivity))
    } yield ()
    ()
  }

  private def withErrorLogging(multiUser: MultiUser, block: MultiUser => Fox[Unit]): Unit =
    block(multiUser).futureBox.map {
      case Full(_)    => ()
      case f: Failure => logger.debug(s"Failed to tag multiuser ${multiUser._id} by activity: $f")
      case Empty      => logger.debug("Failed to tag multiuser ${multiUser._id} by activity: Empty")
    }

  private def tagUserByActivity(multiUser: MultiUser): Fox[Unit] =
    for {
      isActivated <- multiUserDAO.hasAtLeastOneActiveUser(multiUser._id) ?~> "Could not determine isActivated"
      lastActivity <- multiUserDAO.lastActivity(multiUser._id) ?~> "Could not determine lastActivity"
      now = System.currentTimeMillis()
      registeredAtLeast21DaysAgo = multiUser.created < now - (21 days).toMillis
      registeredAtMost22DaysAgo = multiUser.created > now - (22 days).toMillis
      shouldBeTaggedNow = isActivated && registeredAtLeast21DaysAgo && registeredAtMost22DaysAgo
      _ <- if (shouldBeTaggedNow) {
        for {
          previousTags <- mailchimpClient.tagsForMultiUser(multiUser) ?~> "Could not fetch previous tags"
          alreadyTagged = previousTags.contains(MailchimpTag.WasInactiveInWeeksTwoAndThree) || previousTags.contains(
            MailchimpTag.WasActiveInWeeksTwoOrThree)
        } yield
          if (!alreadyTagged) {
            if (lastActivity < now - (14 days).toMillis) {
              logger.info(s"Tagging user ${multiUser._id} as ${MailchimpTag.WasInactiveInWeeksTwoAndThree}...")
              mailchimpClient.tagMultiUser(multiUser, MailchimpTag.WasInactiveInWeeksTwoAndThree)
            } else {
              logger.info(s"Tagging user ${multiUser._id} as ${MailchimpTag.WasActiveInWeeksTwoOrThree}...")
              mailchimpClient.tagMultiUser(multiUser, MailchimpTag.WasActiveInWeeksTwoOrThree)
            }
          }
      } else Fox.successful(())
    } yield ()
}
