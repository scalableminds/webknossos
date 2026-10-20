package backend

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.webknossos.datastore.IdWithBool.{Id32WithBool, Id64WithBool}
import com.scalableminds.webknossos.datastore.SkeletonTracing
import com.scalableminds.webknossos.tracingstore.tracings.AnnotationUserStateUtils
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeTracingDefaults
import org.scalatest.wordspec.AsyncWordSpec

class AnnotationUserStateTestSuite extends AsyncWordSpec with AnnotationUserStateUtils {

  private lazy val userAId = ObjectId("userA")
  private lazy val userBId = ObjectId("userB")
  private lazy val userCId = ObjectId("userC")

  private lazy val dummySkeletonWithUserState = Dummies.skeletonTracing.copy(
    userStates = Seq(
      SkeletonTracing.SkeletonUserStateProto(
        userId = "userA",
        treeVisibilities = Seq(Id32WithBool(1, value = false)),
        treeGroupExpandedStates = Seq(Id32WithBool(1, value = true)),
        activeNodeId = Some(5)
      ),
      SkeletonTracing.SkeletonUserStateProto(
        userId = "userB",
        treeVisibilities = Seq(Id32WithBool(1, value = true), Id32WithBool(2, value = true)),
        treeGroupExpandedStates = Seq.empty,
        activeNodeId = Some(2)
      )
    )
  )

  "Skeleton user state" should {
    "be rendered into new skeleton user state correctly for userA (sparse user state present for them)" in {
      val renderedUserState =
        renderSkeletonUserStateIntoUserState(dummySkeletonWithUserState, userAId, userBId)
      assert(renderedUserState.treeVisibilities == Seq(Id32WithBool(1, false), Id32WithBool(2, true)))
      assert(renderedUserState.activeNodeId.contains(5))
      assert(renderedUserState.treeGroupExpandedStates == Seq(Id32WithBool(1, true)))
    }

    "be rendered into new skeleton user state correctly for userB (owner)" in {
      val renderedUserState =
        renderSkeletonUserStateIntoUserState(dummySkeletonWithUserState, userBId, userBId)
      assert(renderedUserState.treeVisibilities == Seq(Id32WithBool(1, true), Id32WithBool(2, true)))
      assert(renderedUserState.treeGroupExpandedStates == Seq.empty)
    }

    "be rendered into new skeleton user state correctly for userC (no user state present for them)" in {
      val renderedUserState =
        renderSkeletonUserStateIntoUserState(dummySkeletonWithUserState, userCId, userBId)
      assert(renderedUserState.treeVisibilities == Seq(Id32WithBool(1, true), Id32WithBool(2, true)))
      assert(renderedUserState.activeNodeId.contains(2))
      assert(renderedUserState.treeGroupExpandedStates == Seq.empty)
    }

  }

  "volume user states merging" should {
    "respect id mapping" in {
      val tracingAUserStates = Seq(
        VolumeTracingDefaults
          .emptyUserState(userAId)
          .copy(
            segmentVisibilities = Seq(Id64WithBool(1L, true)),
            segmentGroupExpandedStates = Seq(Id32WithBool(1, true)),
            boundingBoxVisibilities = Seq(Id32WithBool(1, true))
          )
      )
      val tracingBUserStates = Seq(
        VolumeTracingDefaults
          .emptyUserState(userAId)
          .copy(
            segmentVisibilities = Seq(Id64WithBool(1L, false)),
            segmentGroupExpandedStates = Seq(Id32WithBool(1, false)),
            boundingBoxVisibilities = Seq(Id32WithBool(1, false))
          )
      )

      val segmentIdMapB = Map((1L, 2L))
      // Unlike segment/group ids, tracing A's bounding box ids can also be remapped (see BoundingBoxMerger),
      // so bboxIdMapA is applied to A's user state just like bboxIdMapB is applied to B's.
      val mergedUserStates = mergeVolumeUserStates(
        tracingAUserStates,
        tracingBUserStates,
        groupMappingB = (groupId: Int) => groupId + 5,
        segmentIdMapB,
        bboxIdMapA = Map(1 -> 10),
        bboxIdMapB = Map(1 -> 11)
      )
      assert(
        mergedUserStates == Seq(
          VolumeTracingDefaults
            .emptyUserState(userAId)
            .copy(
              segmentVisibilities = Seq(Id64WithBool(1, true), Id64WithBool(2L, false)),
              segmentGroupExpandedStates = Seq(Id32WithBool(1, true), Id32WithBool(6, false)),
              boundingBoxVisibilities = Seq(Id32WithBool(10, true), Id32WithBool(11, false))
            )
        )
      )
    }
  }
}
