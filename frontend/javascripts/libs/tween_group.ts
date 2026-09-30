import { Group, Tween } from "@tweenjs/tween.js";

// Tweens only run if they belong to a group that is updated regularly.
// All tweens of the app share this group. It is updated in the render loops
// of the plane and arbitrary views via updateTweens().
const tweenGroup = new Group();

export function createTween<T extends Record<string, any>>(object: T): Tween<T> {
  return new Tween(object, tweenGroup);
}

export function updateTweens() {
  tweenGroup.update();
  // The group keeps finished tweens, so remove them manually.
  // All tweens are started right after their creation. Hence, tweens which
  // aren't playing anymore are finished.
  for (const tween of tweenGroup.getAll()) {
    if (!tween.isPlaying()) {
      tweenGroup.remove(tween);
    }
  }
}
