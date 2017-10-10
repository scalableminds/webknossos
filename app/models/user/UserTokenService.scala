/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.user

import com.scalableminds.util.reactivemongo.DBAccessContext

object UserTokenService {

  def generate(user: User)(implicit ctx: DBAccessContext) = {
    val token = UserToken(user._id)
    UserTokenDAO.insert(token).map(_ => token)
  }

  def findUser(token: UserToken)(implicit ctx: DBAccessContext) = {
    UserDAO.findOneById(token._user)
  }

}
