import { type Intersection, type Object3D, Raycaster } from "three";

export type RaycastIntersection<TIntersected extends Object3D> = Intersection<TIntersected>;

function ascSort(a: RaycastIntersection<Object3D>, b: RaycastIntersection<Object3D>) {
  return a.distance - b.distance;
}

export default class VisibilityAwareRaycaster extends Raycaster {
  // A modified version of the Raycaster.js from js.
  // The original version can be found here: https://github.com/mrdoob/js/blob/dev/src/core/Raycaster.js.
  // Types retrieved from https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/three/src/core/Raycaster.d.ts.
  intersectObjects<TIntersected extends Object3D>(
    objects: Object3D[],
    recursive?: boolean,
    intersects: Intersection<TIntersected>[] = [],
  ): Intersection<TIntersected>[] {
    for (let i = 0, l = objects.length; i < l; i++) {
      if (objects[i].visible) {
        this.intersectObject(objects[i], recursive, intersects);
      }
    }

    intersects.sort(ascSort);

    return intersects;
  }
  intersectObject<TIntersected extends Object3D>(
    object: Object3D,
    recursive?: boolean,
    intersects: Intersection<TIntersected>[] = [],
  ): Intersection<TIntersected>[] {
    if (object.layers.test(this.layers)) {
      object.raycast(this, intersects);
    }

    if (recursive === true) {
      const children = object.children;

      for (let i = 0, l = children.length; i < l; i++) {
        if (children[i].visible) {
          this.intersectObject(children[i], true, intersects);
        }
      }
    }

    intersects.sort(ascSort);

    return intersects;
  }
}
