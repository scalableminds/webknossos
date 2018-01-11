package oxalis.security

import com.mohiva.play.silhouette.api.LoginInfo
import com.mohiva.play.silhouette.api.util.{Clock, IDGenerator}
import com.mohiva.play.silhouette.impl.authenticators.{BearerTokenAuthenticator, BearerTokenAuthenticatorService, BearerTokenAuthenticatorSettings}
import com.mohiva.play.silhouette.impl.daos.AuthenticatorDAO
import com.scalableminds.util.reactivemongo.DBAccessContext
import play.api.libs.json.Writes
import play.api.mvc.RequestHeader

import scala.concurrent.{Await, ExecutionContext, Future}

/**
  * Created by youri on 08.01.18.
  */
class OxalisBearerTokenAuthenticatorService(settings: BearerTokenAuthenticatorSettings,
                                            dao: BearerTokenAuthenticatorDAO,
                                            idGenerator: IDGenerator,
                                            clock: Clock)(implicit override val executionContext: ExecutionContext)
                                            extends BearerTokenAuthenticatorService(settings, dao, idGenerator, clock){

  def addNewAuthenticatorIfNoOneIsValid(loginInfo: LoginInfo)(implicit w: Writes[LoginInfo], ctx: DBAccessContext, request: RequestHeader): Future[BearerTokenAuthenticator] = {
    (for {
      maybeOldToken <-  dao.findOne("loginInfo", loginInfo).futureBox
      newToken <- create(loginInfo)
    } yield {
      if(maybeOldToken.map(_.isValid).getOrElse(false)){
        Future.successful(maybeOldToken.get)
        //dao.add(newToken)
      } else {
        dao.add(newToken)
      }
    }).flatMap(identity)
  }

}
