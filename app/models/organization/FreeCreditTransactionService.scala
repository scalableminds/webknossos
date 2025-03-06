package models.organization

import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.helpers.IntervalScheduler
import com.typesafe.scalalogging.LazyLogging
import controllers.Controller
import org.apache.pekko.actor.ActorSystem
import play.api.inject.ApplicationLifecycle

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.{DurationInt, FiniteDuration}

class FreeCreditTransactionService @Inject()(creditTransactionDAO: CreditTransactionDAO,
                                             val lifecycle: ApplicationLifecycle,
                                             val actorSystem: ActorSystem)(implicit val ec: ExecutionContext)
    extends Controller
    with FoxImplicits
    with LazyLogging
    with IntervalScheduler {

  def revokeExpiredCredits(): Fox[Unit] = creditTransactionDAO.runRevokeExpiredCredits()
  def handOutMonthlyFreeCredits(): Fox[Unit] = creditTransactionDAO.handOutMonthlyFreeCredits()

  override protected def tickerInterval: FiniteDuration = 20 minutes

  override protected def tick(): Fox[Unit] =
    for {
      before <- Instant.nowFox
      _ <- revokeExpiredCredits()
      _ <- handOutMonthlyFreeCredits()
      _ = Instant.logSince(before, "Finished revoking and handing out free monthly credits.")
    } yield ()

}
