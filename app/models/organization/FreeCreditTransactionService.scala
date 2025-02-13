package models.organization

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
                                             val system: ActorSystem)(implicit val ec: ExecutionContext)
    extends Controller
    with FoxImplicits
    with LazyLogging
    with IntervalScheduler {

  def revokeExpiredCredits(): Fox[Unit] = creditTransactionDAO.runRevokeExpiredCredits()
  def handOutMonthlyFreeCredits(): Fox[Unit] = creditTransactionDAO.handOutMonthlyFreeCredits()

  override protected def tickerInterval: FiniteDuration = 20 minute

  override protected def tick(): Unit =
    for {
      _ <- Fox.successful(())
      _ = logger.info("Starting revoking expired credits...")
      _ <- revokeExpiredCredits()
      _ = logger.info("Finished revoking expired credits.")
      _ = logger.info("Staring handing out free monthly credits.")
      _ <- handOutMonthlyFreeCredits()
      _ = logger.info("Finished handing out free monthly credits.")
    } yield ()
}
