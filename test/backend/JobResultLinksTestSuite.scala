package backend

import com.scalableminds.util.objectid.ObjectId
import models.job.JobCommand.JobCommand
import models.job.JobState.JobState
import models.job.{JobCommand, JobResultLinks, JobState}
import org.scalatest.wordspec.AsyncWordSpec
import play.api.libs.json.{JsObject, Json}

class JobResultLinksTestSuite extends AsyncWordSpec {

  private case class TestJob(
      command: JobCommand,
      args: JsObject,
      effectiveState: JobState = JobState.SUCCESS,
      returnValue: Option[String] = None
  ) extends JobResultLinks {
    protected val id: ObjectId = ObjectId.generate
  }

  "constructResultLink" should {
    "link to the trained model for successful training jobs" in {
      val modelId = ObjectId.generate.toString
      Seq(JobCommand.train_neuron_model, JobCommand.train_instance_model).foreach { command =>
        val job = TestJob(command, Json.obj("model_id" -> modelId))
        assert(job.constructResultLink("orga").contains(s"/aiModels#$modelId"))
        assert(job.resultLinkPublic("orga", "https://wk.example").contains(s"https://wk.example/aiModels#$modelId"))
      }
      succeed
    }
    "link to the model list if the training job has no model id" in {
      val job = TestJob(JobCommand.train_model, Json.obj())
      assert(job.constructResultLink("orga").contains("/aiModels"))
    }
    "not link anywhere for unfinished training jobs" in {
      val job = TestJob(JobCommand.train_neuron_model, Json.obj("model_id" -> "abc"), JobState.STARTED)
      assert(job.constructResultLink("orga").isEmpty)
    }
  }
}
