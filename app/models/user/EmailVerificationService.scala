package models.user

import org.apache.pekko.actor.ActorSystem
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import mail.{DefaultMails, Send}
import security.RandomIDGenerator
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class EmailVerificationService @Inject()(conf: WkConf,
                                         emailVerificationKeyDAO: EmailVerificationKeyDAO,
                                         multiUserDAO: MultiUserDAO,
                                         defaultMails: DefaultMails,
                                         actorSystem: ActorSystem)
    extends LazyLogging {

  private lazy val Mailer =
    actorSystem.actorSelection("/user/mailActor")

  def sendEmailVerification(user: User)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      multiUser <- multiUserDAO.findOne(user._multiUser)(ctx)
      key: String = RandomIDGenerator.generateBlocking(32)
      expiration = conf.WebKnossos.User.EmailVerification.linkExpiry.map(Instant.now + _)
      evk: EmailVerificationKey = EmailVerificationKey(ObjectId.generate,
                                                       key,
                                                       multiUser.email,
                                                       multiUser._id,
                                                       expiration,
                                                       isUsed = false)
      _ <- emailVerificationKeyDAO.insertOne(evk)
      fullVerificationLink = s"${conf.Http.uri}/verifyEmail/$key"
      _ = logger.info(s"Sending email verification mail for user with email ${multiUser.email}")
      _ = Mailer ! Send(defaultMails.emailVerificationMail(user, multiUser.email, fullVerificationLink))
    } yield ()

  def verify(key: String)(implicit ctx: DBAccessContext, ec: ExecutionContext): Fox[Unit] =
    for {
      isEmailVerified <- isEmailAlreadyVerifiedByKey(key)
      _ <- Fox.runIf(!isEmailVerified)(checkAndVerify(key))
    } yield ()

  private def isEmailAlreadyVerifiedByKey(key: String)(implicit ctx: DBAccessContext): Fox[Boolean] =
    for {
      evk <- emailVerificationKeyDAO.findOneByKey(key) ?~> "user.email.verification.keyInvalid"
      multiUser <- multiUserDAO.findOne(evk._multiUser) ?~> "user.notFound"
    } yield multiUser.isEmailVerified

  private def checkAndVerify(key: String)(implicit ctx: DBAccessContext, ec: ExecutionContext): Fox[Unit] =
    for {
      evk <- emailVerificationKeyDAO.findOneByKey(key) ?~> "user.email.verification.keyInvalid"
      multiUser <- multiUserDAO.findOne(evk._multiUser) ?~> "user.notFound"
      _ <- Fox.bool2Fox(!evk.isUsed) ?~> "user.email.verification.keyUsed"
      _ <- Fox.bool2Fox(evk.validUntil.forall(!_.isPast)) ?~> "user.email.verification.linkExpired"
      _ <- Fox.bool2Fox(evk.email == multiUser.email) ?~> "user.email.verification.emailDoesNotMatch"
      _ = multiUserDAO.updateEmailVerification(evk._multiUser, verified = true)
      _ <- emailVerificationKeyDAO.markAsUsed(evk._id)
    } yield ()

  def assertEmailVerifiedOrResendVerificationMail(user: User)(
      implicit ctx: DBAccessContext,
      ec: ExecutionContext
  ): Fox[Unit] =
    for {
      emailVerificationOk <- userHasVerifiedEmail(user)
      _ <- Fox.runIf(!emailVerificationOk)(sendEmailVerification(user))
      _ <- Fox.bool2Fox(emailVerificationOk) ?~> "user.email.notVerified"
    } yield ()

  private def userHasVerifiedEmail(user: User)(
      implicit ctx: DBAccessContext
  ): Fox[Boolean] =
    for {
      multiUser: MultiUser <- multiUserDAO.findOne(user._multiUser) ?~> "user.notFound"
      endOfGracePeriod: Instant = multiUser.created + conf.WebKnossos.User.EmailVerification.gracePeriod
      overGracePeriod = endOfGracePeriod.isPast
    } yield !conf.WebKnossos.User.EmailVerification.required || multiUser.isEmailVerified || !overGracePeriod
}
