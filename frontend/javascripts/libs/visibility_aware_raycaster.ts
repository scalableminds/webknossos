import * as THREE from "three";

export type RaycastIntersection<TIntersected extends THREE.Object3D> =
  THREE.Intersection<TIntersected>;

function ascSort(a: RaycastIntersection<THREE.Object3D>, b: RaycastIntersection<THREE.Object3D>) {
  return a.distance - b.distance;
}

export default class VisibilityAwareRaycaster extends THREE.Raycaster {
  // A modified version of the Raycaster.js from three.js.
  // The original version can be found here: https://github.com/mrdoob/three.js/blob/dev/src/core/Raycaster.js.
  // Types retrieved from https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/three/src/core/Raycaster.d.ts.
  intersectObjects<TIntersected extends THREE.Object3D>(
    objects: THREE.Object3D[],
    recursive?: boolean,
    intersects: THREE.Intersection<TIntersected>[] = [],
  ): THREE.Intersection<TIntersected>[] {
    for (let i = 0, l = objects.length; i < l; i++) {
      if (objects[i].visible) {
        this.intersectObject(objects[i], recursive, intersects);
      }
    }

    intersects.sort(ascSort);

    return intersects;
  }
  intersectObject<TIntersected extends THREE.Object3D>(
    object: THREE.Object3D,
    recursive?: boolean,
    intersects: THREE.Intersection<TIntersected>[] = [],
  ): THREE.Intersection<TIntersected>[] {
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
