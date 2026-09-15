package security

import com.scalableminds.util.objectid.ObjectId
import play.silhouette.api.LoginInfo
import play.silhouette.impl.providers.CredentialsProvider

// The auth library silhouette expects a LoginInfo object instead of just the user id.
object LoginInfoAdapter {
  def loginInfoFromUserId(userId: ObjectId): LoginInfo =
    LoginInfo(CredentialsProvider.ID, userId.toString)

  def userIdFromLoginInfo(loginInfo: LoginInfo): ObjectId =
    ObjectId(loginInfo.providerKey)
}
