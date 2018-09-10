import com.newrelic.api.agent.NewRelic
import javax.inject._
import play.api.http.DefaultHttpErrorHandler
import play.api._
import play.api.mvc._
import play.api.routing.Router

@Singleton
class ErrorHandler @Inject() (env: Environment,
                              config: Configuration,
                              sourceMapper: OptionalSourceMapper,
                              router: Provider[Router])
  extends DefaultHttpErrorHandler(env, config, sourceMapper, router) {
  override def onServerError(request: RequestHeader, ex: Throwable) = {
    NewRelic.noticeError(ex)
    super.onServerError(request, ex)
  }
}
