package telemetry

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.slacknotification.SlackClient
import com.typesafe.scalalogging.LazyLogging

import javax.inject.Inject
import utils.WkConf

class SlackNotificationService @Inject()(rpc: RPC, config: WkConf) extends LazyLogging {

  private lazy val slackClient = new SlackClient(rpc,
                                                 config.SlackNotifications.uri,
                                                 name = s"WEBKNOSSOS at ${config.Http.uri}",
                                                 config.SlackNotifications.verboseLoggingEnabled)

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

  def info(title: String, msg: String): Unit =
    slackClient.info(
      title = title,
      msg = msg
    )

  def success(title: String, msg: String): Unit =
    slackClient.success(
      title = title,
      msg = msg
    )

  def noticeFailedJobRequest(msg: String): Unit =
    slackClient.warn(
      title = "Failed job request",
      msg = msg
    )

  def noticeBaseAnnotationTaskCreation(taskTypeId: ObjectId, numberOfTasks: Int): Unit =
    slackClient.info(
      title = "Task creation with base",
      msg = s"$numberOfTasks tasks with BaseAnnotation for TaskType $taskTypeId have been created"
    )

  def noticeSlowRequest(msg: String): Unit =
    slackClient.info(
      title = "Slow request",
      msg = msg
    )
}
