package oxalis.telemetry

import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.tracingstore.slacknotification.SlackClient
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import utils.WkConf

class SlackNotificationService @Inject()(rpc: RPC, config: WkConf) extends LazyLogging {

  private lazy val slackClient = new SlackClient(rpc, config.SlackNotifications.url, name = s"webKnossos at ${config.Http.uri}")

  def warnWithException(title: String, ex: Throwable, msg: String): Unit =
    slackClient.warn(
      title = title,
      msg = s"${ex.toString}: ${ex.getLocalizedMessage}\n$msg"
    )

  def warn(title: String, msg: String): Unit =
    slackClient.warn(
      title = title,
      msg = msg
    )

  def noticeBaseAnnotationTaskCreation(taskType: List[String], numberOfTasks: Int): Unit =
    slackClient.info(
      title = "Task creation with base",
      msg = s"$numberOfTasks tasks with BaseAnnotation for TaskTypes ${taskType.mkString(", ")} have been created"
    )
}
