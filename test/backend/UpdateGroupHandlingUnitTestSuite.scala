package backend

import com.scalableminds.webknossos.tracingstore.annotation.{RevertToVersionAnnotationAction, UpdateGroupHandling}
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating.MergeTreeSkeletonAction
import net.liftweb.common.Failure
import org.scalatestplus.play.PlaySpec

class UpdateGroupHandlingUnitTestSuite extends PlaySpec with UpdateGroupHandling {

  "regroupByIsolationSensitiveActions" should {
    "isolate sensitive actions, group the rest, reverse group order" in {
      val updateGroupsBefore = List(
        (8L,
         List(
           MergeTreeSkeletonAction(sourceId = 1, targetId = 2, actionTracingId = Dummies.tracingId),
           MergeTreeSkeletonAction(sourceId = 2, targetId = 3, actionTracingId = Dummies.tracingId)
         )),
        (7L,
         List(
           MergeTreeSkeletonAction(sourceId = 1, targetId = 2, actionTracingId = Dummies.tracingId),
           MergeTreeSkeletonAction(sourceId = 2, targetId = 3, actionTracingId = Dummies.tracingId)
         )),
        (6L,
         List(
           RevertToVersionAnnotationAction(sourceVersion = 1)
         )),
        (5L,
         List(
           MergeTreeSkeletonAction(sourceId = 1, targetId = 2, actionTracingId = Dummies.tracingId),
           MergeTreeSkeletonAction(sourceId = 2, targetId = 3, actionTracingId = Dummies.tracingId)
         ))
      )
      val res = regroupByIsolationSensitiveActions(updateGroupsBefore).openOrThrowException("test context")
      // Expect 5 to be untouched
      assert(res(0)._2.length == 2)
      assert(res(0)._1 == 5L)
      // Expect 6 to be isolated
      assert(res(1)._2.length == 1)
      assert(res(1)._1 == 6L)
      // Expect 7 and 8 to be grouped, with targetVersion 8
      assert(res(2)._2.length == 4)
      assert(res(2)._1 == 8L)
      assert(res.length == 3)
    }

    "still work if last action is isolationSensitive" in {
      val updateGroupsBefore = List(
        (7L,
         List(
           RevertToVersionAnnotationAction(sourceVersion = 1)
         )),
        (6L,
         List(
           MergeTreeSkeletonAction(sourceId = 1, targetId = 2, actionTracingId = Dummies.tracingId),
           MergeTreeSkeletonAction(sourceId = 2, targetId = 3, actionTracingId = Dummies.tracingId)
         )),
        (5L,
         List(
           MergeTreeSkeletonAction(sourceId = 1, targetId = 2, actionTracingId = Dummies.tracingId),
           MergeTreeSkeletonAction(sourceId = 2, targetId = 3, actionTracingId = Dummies.tracingId)
         )),
        (4L,
         List(
           RevertToVersionAnnotationAction(sourceVersion = 1)
         )),
        (3L,
         List(
           MergeTreeSkeletonAction(sourceId = 1, targetId = 2, actionTracingId = Dummies.tracingId),
           MergeTreeSkeletonAction(sourceId = 2, targetId = 3, actionTracingId = Dummies.tracingId)
         ))
      )
      val res = regroupByIsolationSensitiveActions(updateGroupsBefore).openOrThrowException("test context")
      assert(res.length == 4)
      assert(res(0)._2.length == 2)
      assert(res(0)._1 == 3L)
      assert(res(1)._2.length == 1)
      assert(res(1)._1 == 4L)
      assert(res(2)._2.length == 4)
      assert(res(2)._1 == 6L)
      assert(res(3)._2.length == 1)
      assert(res(3)._1 == 7L)
    }

    "leave single action untouched" in {
      val updateGroupsBefore = List(
        (7L,
         List(
           RevertToVersionAnnotationAction(sourceVersion = 1)
         ))
      )
      val res = regroupByIsolationSensitiveActions(updateGroupsBefore).openOrThrowException("test context")
      assert(res.length == 1)
      assert(res(0)._2.length == 1)
      assert(res(0)._1 == 7L)
    }

    "return Failure box if input is not sorted in descending order" in {
      val updateGroupsBefore = List(
        (3L,
         List(
           MergeTreeSkeletonAction(sourceId = 1, targetId = 2, actionTracingId = Dummies.tracingId),
           MergeTreeSkeletonAction(sourceId = 2, targetId = 3, actionTracingId = Dummies.tracingId)
         )),
        (4L,
         List(
           MergeTreeSkeletonAction(sourceId = 1, targetId = 2, actionTracingId = Dummies.tracingId),
           MergeTreeSkeletonAction(sourceId = 2, targetId = 3, actionTracingId = Dummies.tracingId)
         ))
      )
      val res = regroupByIsolationSensitiveActions(updateGroupsBefore)
      assert(res.isInstanceOf[Failure])
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
