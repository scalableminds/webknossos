package backend

import com.scalableminds.webknossos.tracingstore.annotation.{RevertToVersionAnnotationAction, UpdateGroupHandling}
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating.MergeTreeSkeletonAction
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
           RevertToVersionAnnotationAction(sourceVersion = 1)
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
         ))
      )
      val res = regroupByIsolationSensitiveActions(updateGroupsBefore)
      assert(res.length == 3)
      assert(res(1)._2.length == 1)
      assert(res(1)._1 == 6L)
    }

    "work if last element is isolationSensitive" in {
      val updateGroupsBefore = List(
        (5L,
         List(
           MergeTreeSkeletonAction(sourceId = 1, targetId = 2, actionTracingId = Dummies.tracingId),
           MergeTreeSkeletonAction(sourceId = 2, targetId = 3, actionTracingId = Dummies.tracingId)
         )),
        (6L,
         List(
           RevertToVersionAnnotationAction(sourceVersion = 1)
         )),
        (7L,
         List(
           RevertToVersionAnnotationAction(sourceVersion = 1)
         ))
      )
      val res = regroupByIsolationSensitiveActions(updateGroupsBefore)
      assert(res.length == 3)
      assert(res(1)._2.length == 1)
      assert(res(1)._1 == 6L)
    }
  }

  "ironOutReverts" should {
    "work" in {
      val updateGroupsBefore = List(
        (6L,
         List(
           MergeTreeSkeletonAction(sourceId = 7, targetId = 7, actionTracingId = Dummies.tracingId),
           MergeTreeSkeletonAction(sourceId = 8, targetId = 8, actionTracingId = Dummies.tracingId)
         )),
        (5L,
         List(
           RevertToVersionAnnotationAction(sourceVersion = 2)
         )),
        (4L,
         List(
           // Should be dropped, since we jump from 5 to 2
           RevertToVersionAnnotationAction(sourceVersion = 1)
         )),
        (3L,
         List(
           // Should be dropped, since we jump from 5 to 2
           MergeTreeSkeletonAction(sourceId = 5, targetId = 5, actionTracingId = Dummies.tracingId),
           MergeTreeSkeletonAction(sourceId = 6, targetId = 6, actionTracingId = Dummies.tracingId)
         )),
        (2L,
         List(
           MergeTreeSkeletonAction(sourceId = 3, targetId = 3, actionTracingId = Dummies.tracingId),
           MergeTreeSkeletonAction(sourceId = 4, targetId = 4, actionTracingId = Dummies.tracingId)
         )),
        (1L,
         List(
           MergeTreeSkeletonAction(sourceId = 1, targetId = 1, actionTracingId = Dummies.tracingId),
           MergeTreeSkeletonAction(sourceId = 2, targetId = 2, actionTracingId = Dummies.tracingId)
         ))
      )

      val res = ironOutReverts(updateGroupsBefore)
      assert(res.length == 6)
      assert(
        res.headOption.contains(
          MergeTreeSkeletonAction(sourceId = 1, targetId = 1, actionTracingId = Dummies.tracingId)))
      assert(
        res.lastOption.contains(
          MergeTreeSkeletonAction(sourceId = 8, targetId = 8, actionTracingId = Dummies.tracingId)))
      assert(!res.contains(MergeTreeSkeletonAction(sourceId = 6, targetId = 6, actionTracingId = Dummies.tracingId)))
    }
  }

}
