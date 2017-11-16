package oxalis.security
import com.mohiva.play.silhouette.api.AuthInfo
import com.mohiva.play.silhouette.api.util.PasswordInfo
import com.scalableminds.util.security.SCrypt

/**
  * Created by youri on 07.09.17.
  */

class PasswordHasher extends com.mohiva.play.silhouette.api.util.PasswordHasher{
  override def id: String = "SCrypt"

  override def hash(plainPassword: String): PasswordInfo = PasswordInfo(id, SCrypt.hashPassword(plainPassword))

  override def matches(passwordInfo: PasswordInfo, suppliedPassword: String): Boolean = SCrypt.verifyPassword(suppliedPassword, passwordInfo.password)
}
