package backend

import com.scalableminds.webknossos.tracingstore.annotation.{RevertToVersionUpdateAction, UpdateGroupHandling}
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating.{MergeTreeSkeletonAction}
import org.scalatestplus.play.PlaySpec

class UpdateGroupHandlingUnitTestSuite extends PlaySpec with UpdateGroupHandling {

  "regroup" should {
    "work" in {
      val updateGroupsBefore = List(
        (5L,
         List(
           MergeTreeSkeletonAction(sourceId = 1, targetId = 2, actionTracingId = Dummies.tracingId),
           MergeTreeSkeletonAction(sourceId = 2, targetId = 3, actionTracingId = Dummies.tracingId)
         )),
        (6L,
         List(
           RevertToVersionUpdateAction(sourceVersion = 1),
         )),
        (7L,
         List(
           MergeTreeSkeletonAction(sourceId = 1, targetId = 2, actionTracingId = Dummies.tracingId),
           MergeTreeSkeletonAction(sourceId = 2, targetId = 3, actionTracingId = Dummies.tracingId)
         )),
        (8L,
         List(
           MergeTreeSkeletonAction(sourceId = 1, targetId = 2, actionTracingId = Dummies.tracingId),
           MergeTreeSkeletonAction(sourceId = 2, targetId = 3, actionTracingId = Dummies.tracingId)
         )),
      )
      val res = regroupByIsolationSensitiveActions(updateGroupsBefore)
      assert(res.length == 3)
      assert(res(1)._2.length == 1)
      assert(res(1)._1 == 6L)
    }
  }

}
