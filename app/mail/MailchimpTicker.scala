package mail

import org.apache.pekko.actor.ActorSystem
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.helpers.IntervalScheduler
import com.typesafe.scalalogging.LazyLogging

import javax.inject.Inject
import models.user.{MultiUser, MultiUserDAO}
import com.scalableminds.util.tools.{Empty, Failure, Full}
import play.api.inject.ApplicationLifecycle

import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class MailchimpTicker @Inject()(val lifecycle: ApplicationLifecycle,
                                val system: ActorSystem,
                                multiUserDAO: MultiUserDAO,
                                mailchimpClient: MailchimpClient)(implicit val ec: ExecutionContext)
    extends IntervalScheduler
    with LazyLogging {

  implicit val ctx: DBAccessContext = GlobalAccessContext

  override protected def tickerInterval: FiniteDuration = 1 hour

  override protected def tickerInitialDelay: FiniteDuration = 1 hour

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
      case Empty      => logger.debug(s"Failed to tag multiuser ${multiUser._id} by activity: Empty")
    }

  private def tagUserByActivity(multiUser: MultiUser): Fox[Unit] =
    for {
      isActivated <- multiUserDAO.hasAtLeastOneActiveUser(multiUser._id) ?~> "Could not determine isActivated"
      lastActivity <- if (isActivated) multiUserDAO.lastActivity(multiUser._id) ?~> "Could not determine lastActivity"
      else Fox.successful(Instant.zero)
      registeredAtLeast21DaysAgo = (multiUser.created + (21 days)).isPast
      registeredAtMost22DaysAgo = !(multiUser.created + (22 days)).isPast
      shouldBeTaggedNow = isActivated && registeredAtLeast21DaysAgo && registeredAtMost22DaysAgo
      _ <- if (shouldBeTaggedNow) {
        for {
          previousTags <- mailchimpClient.tagsForMultiUser(multiUser) ?~> "Could not fetch previous tags"
          alreadyTagged = previousTags.contains(MailchimpTag.WasInactiveInWeeksTwoAndThree) || previousTags.contains(
            MailchimpTag.WasActiveInWeeksTwoOrThree)
        } yield
          if (!alreadyTagged) {
            if ((lastActivity + (14 days)).isPast) {
              logger.info(s"Tagging multiuser ${multiUser._id} as ${MailchimpTag.WasInactiveInWeeksTwoAndThree}...")
              mailchimpClient.tagMultiUser(multiUser, MailchimpTag.WasInactiveInWeeksTwoAndThree)
            } else {
              logger.info(s"Tagging multiuser ${multiUser._id} as ${MailchimpTag.WasActiveInWeeksTwoOrThree}...")
              mailchimpClient.tagMultiUser(multiUser, MailchimpTag.WasActiveInWeeksTwoOrThree)
            }
          }
      } else Fox.successful(())
    } yield ()
}
