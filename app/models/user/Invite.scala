package models.user

import org.apache.pekko.actor.ActorSystem
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.schema.Tables._
import com.typesafe.scalalogging.LazyLogging
import mail.{DefaultMails, Send}

import javax.inject.Inject
import models.organization.OrganizationDAO
import security.RandomIDGenerator
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.sql.{SQLDAO, SqlClient}
import utils.WkConf

import scala.concurrent.{ExecutionContext, Future}

case class Invite(
    _id: ObjectId,
    tokenValue: String,
    _organization: String,
    autoActivate: Boolean,
    expirationDateTime: Instant,
    created: Instant = Instant.now,
    isDeleted: Boolean = false
)

class InviteService @Inject()(conf: WkConf,
                              actorSystem: ActorSystem,
                              defaultMails: DefaultMails,
                              organizationDAO: OrganizationDAO,
                              inviteDAO: InviteDAO)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {
  private val tokenValueGenerator = new RandomIDGenerator
  private lazy val Mailer =
    actorSystem.actorSelection("/user/mailActor")

  def inviteOneRecipient(recipient: String, sender: User, autoActivate: Boolean)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      invite <- Fox.fromFuture(generateInvite(sender._organization, autoActivate))
      _ <- inviteDAO.insertOne(invite)
      _ <- sendInviteMail(recipient, sender, invite)
    } yield ()

  private def generateInvite(organizationId: String, autoActivate: Boolean): Future[Invite] =
    for {
      tokenValue <- tokenValueGenerator.generate
    } yield
      Invite(
        ObjectId.generate,
        tokenValue,
        organizationId,
        autoActivate,
        Instant.in(conf.WebKnossos.User.inviteExpiry)
      )

  private def sendInviteMail(recipient: String, sender: User, invite: Invite)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      organization <- organizationDAO.findOne(invite._organization)
      _ = logger.info("sending invite mail")
      _ = Mailer ! Send(
        defaultMails.inviteMail(recipient, invite.tokenValue, invite.autoActivate, organization.name, sender.name))
    } yield ()

  def removeExpiredInvites(): Fox[Unit] =
    inviteDAO.deleteAllExpired()

  def deactivateUsedInvite(invite: Invite)(implicit ctx: DBAccessContext): Fox[Unit] =
    inviteDAO.deleteOne(invite._id)

  def findInviteByTokenOpt(tokenValueOpt: Option[String]): Fox[Invite] =
    tokenValueOpt match {
      case Some(tokenValue) => inviteDAO.findOneByTokenValue(tokenValue)
      case None             => Fox.failure("No invite Token")
    }

}

class InviteDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[Invite, InvitesRow, Invites](sqlClient) {
  protected val collection = Invites

  protected def idColumn(x: Invites): Rep[String] = x._Id

  protected def isDeletedColumn(x: Invites): Rep[Boolean] = x.isdeleted

  protected def parse(r: InvitesRow): Fox[Invite] =
    Fox.successful(
      Invite(
        ObjectId(r._Id),
        r.tokenvalue,
        r._Organization,
        r.autoactivate,
        Instant.fromSql(r.expirationdatetime),
        Instant.fromSql(r.created),
        r.isdeleted
      ))

  def findOneByTokenValue(tokenValue: String): Fox[Invite] =
    for {
      rOpt <- run(Invites.filter(r => notdel(r) && r.tokenvalue === tokenValue).result.headOption)
      r <- rOpt.toFox
      parsed <- parse(r)
    } yield parsed

  def insertOne(i: Invite): Fox[Unit] =
    for {
      _ <- run(
        q"""INSERT INTO webknossos.invites(_id, tokenValue, _organization, autoActivate, expirationDateTime, created, isDeleted)
            VALUES(${i._id}, ${i.tokenValue}, ${i._organization}, ${i.autoActivate},
            ${i.expirationDateTime}, ${i.created}, ${i.isDeleted})""".asUpdate)
    } yield ()

  def deleteAllExpired(): Fox[Unit] = {
    val query = for {
      row <- collection if notdel(row) && row.expirationdatetime <= Instant.now.toSql
    } yield isDeletedColumn(row)
    for { _ <- run(query.update(true)) } yield ()
  }

}
