package utils.sql

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import models.user.User
import com.scalableminds.util.tools.Full
import security.{SharingTokenContainer, UserSharingTokenContainer}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

abstract class SecuredSQLDAO @Inject() (sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {
  protected def collectionName: SqlToken
  protected def existingCollectionName: SqlToken = SqlToken.raw(collectionName.sql + "_")

  protected def anonymousReadAccessQ(sharingToken: Option[String]): SqlToken = q"FALSE"
  protected def readAccessQ(requestingUserId: ObjectId): SqlToken = q"TRUE"
  protected def updateAccessQ(requestingUserId: ObjectId): SqlToken = readAccessQ(requestingUserId)
  protected def deleteAccessQ(requestingUserId: ObjectId): SqlToken = readAccessQ(requestingUserId)

  protected def readAccessQuery(using ctx: DBAccessContext): Fox[SqlToken] =
    if (ctx.globalAccess) Fox.successful(q"TRUE")
    else {
      for {
        userIdBox <- userIdFromCtx.shiftBox
      } yield userIdBox match {
        case Full(userId) => readAccessFromUserOrToken(userId, sharingTokenFromCtx)(using ctx)
        case _            => anonymousReadAccessQ(sharingTokenFromCtx)
      }
    }

  def assertUpdateAccess(id: ObjectId)(using ctx: DBAccessContext): Fox[Unit] =
    if (ctx.globalAccess) Fox.successful(())
    else {
      for {
        userId <- userIdFromCtx ?~> "FAILED: userIdFromCtx"
        resultList <- run(
          q"SELECT _id FROM $existingCollectionName WHERE _id = $id AND (${updateAccessQ(userId)})".as[String]
        ) ?~> "Failed to check write access. Does the object exist?"
        _ <- resultList.headOption.toFox ?~> "No update access."
      } yield ()
    }

  def assertDeleteAccess(id: ObjectId)(using ctx: DBAccessContext): Fox[Unit] =
    if (ctx.globalAccess) Fox.successful(())
    else {
      for {
        userId <- userIdFromCtx
        resultList <- run(
          q"SELECT _id FROM $existingCollectionName WHERE _id = $id AND (${deleteAccessQ(userId)})".as[String]
        ) ?~> "Failed to check delete access. Does the object exist?"
        _ <- resultList.headOption.toFox ?~> "No delete access."
      } yield ()
    }

  protected def userIdFromCtx(using ctx: DBAccessContext): Fox[ObjectId] =
    ctx.data match {
      case Some(user: User)                                           => Fox.successful(user._id)
      case Some(userSharingTokenContainer: UserSharingTokenContainer) =>
        Fox.successful(userSharingTokenContainer.user._id)
      case _ => Fox.failure("Access denied.")
    }

  protected def accessQueryFromAccessQWithPrefix(accessQ: (ObjectId, SqlToken) => SqlToken, prefix: SqlToken)(using
      ctx: DBAccessContext
  ): Fox[SqlToken] =
    if (ctx.globalAccess) Fox.successful(q"TRUE")
    else {
      for {
        userIdBox <- userIdFromCtx.shiftBox
      } yield userIdBox match {
        case Full(userId) => q"(${accessQ(userId, prefix)})"
        case _            => q"FALSE"
      }
    }

  protected def accessQueryFromAccessQ(accessQ: ObjectId => SqlToken)(using ctx: DBAccessContext): Fox[SqlToken] =
    if (ctx.globalAccess) Fox.successful(q"TRUE")
    else {
      for {
        userIdBox <- userIdFromCtx.shiftBox
      } yield userIdBox match {
        case Full(userId) => q"(${accessQ(userId)})"
        case _            => q"FALSE"
      }
    }

  private def sharingTokenFromCtx(using ctx: DBAccessContext): Option[String] =
    ctx.data match {
      case Some(sharingTokenContainer: SharingTokenContainer)         => Some(sharingTokenContainer.sharingToken)
      case Some(userSharingTokenContainer: UserSharingTokenContainer) =>
        userSharingTokenContainer.sharingToken
      case _ => None
    }

  private def readAccessFromUserOrToken(userId: ObjectId, tokenOption: Option[String])(using
      ctx: DBAccessContext
  ): SqlToken =
    tokenOption match {
      case Some(_) => q"((${anonymousReadAccessQ(sharingTokenFromCtx)}) OR (${readAccessQ(userId)}))"
      case _       => q"(${readAccessQ(userId)})"
    }

}
