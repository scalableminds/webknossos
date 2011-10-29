/**
  @class FreeCamera
  
  @version 0.000001 alpha
*/
var FreeCam = (function(){

  function FreeCam(config) {

    var trans = [ 1, 0, 0, 0,  // left
                  0, 1, 0, 0,  // up
                  0, 0, 1, 0,  // direction
                  0, 0, 0, 1]; // position
    
    var rotMat;
    /**
      Get the camera position.
      
      @return {Array} Array of three values.
    */
    this.__defineGetter__("pos", function(){
      return [trans[12], trans[13], trans[14]];
    });
    
    /**
      Set the camera position.
      
      @return {Array} Array of three values.
    */
    this.__defineSetter__("pos", function(p){
      trans[12] = p[0];
      trans[13] = p[1];
      trans[14] = p[2];
    });
    
    /**
      Get the direction of the camera.
      
      @return {Array} Array of three values.
    */
    this.__defineGetter__("dir", function(){
      return [trans[8], trans[9], trans[10]];
    });
    
    /**
      Get the camera's up vector.
      
      @return {Array} Array of three values.
    */
    this.__defineGetter__("up", function(){
      return [trans[4], trans[5], trans[6]];
    });

    /**
      Get the camera's left vector.
      
      @return {Array} Array of three values.
    */
    this.__defineGetter__("left", function(){
      return [trans[0], trans[1], trans[2]];
    });
    
    /**
      Get a copy of the camera's transformation matrix.
      
      @returns {Array} 
    */
    this.getMatrix = function(){
      return  M4x4.clone(trans);
    };
    
    /**
      Set the camera's transformation matrix to an identity matrix.
    */
    this.reset = function(){
      trans = [ 1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                0, 0, 0, 1];
    };
    
    /**
    */
    this.move = function(p){
      var tranMat = M4x4.makeTranslate([p[0],p[1],p[2]]);
      trans = M4x4.mul(trans, tranMat);      
    };

    /**
    */
    this.yaw = function(angle){
      rotMat = M4x4.makeRotate(angle, this.up);
      trans = M4x4.mul(trans, rotMat);
    };

    /**
    */
    this.roll = function(angle){
      rotMat = M4x4.makeRotate(angle, this.direction);
      trans = M4x4.mul(trans, rotMat);
    };

    /**
      Pitch the camera about its current left vector.
      
      @param {Number} angle in radians.
    */
    this.pitch = function(angle){
      rotMat = M4x4.makeRotate(angle, this.left);
      trans = M4x4.mul(trans, rotMat);
    };
    
    this.rotateOnAxis = function(angle, axis){
      rotMat = M4x4.makeRotate(angle, axis);
      trans = M4x4.mul(trans, rotMat);
    };
    
    /**
      Get a string representation of this camera. Useful for debugging.
      
      @return {String}
    */
    this.toString = function(){
      return "[" + trans[ 0] + ", " + trans[ 1] + ", " + trans[ 2] + ", " + trans[ 3] + ", " +
                   trans[ 4] + ", " + trans[ 5] + ", " + trans[ 6] + ", " + trans[ 7] + ", " +
                   trans[ 8] + ", " + trans[ 9] + ", " + trans[10] + ", " + trans[11] + ", " +
                   trans[12] + ", " + trans[13] + ", " + trans[14] + ", " + trans[15] + "]";
    };    
  }
  return FreeCam;
}());


/**
  @class OrbitCamera
  
  @version 0.000001 alpha
*/
var OrbitCam = (function(){

  function OrbitCam(config) {
    
    // This value cannot be set to less than 0.
    var closestDistance = config.closest || 0;
    
    // This value cannot be set less than closest distance.
    var farthestDistance = config.farthest || 100;
    
    // The point in space the camera will orbit.
    var orbitPoint = V3.$(0, 0, 0);
    
    // Transformation matrix
    var left = V3.$(-1, 0, 0);
    var up =   V3.$( 0, 1, 0);
    var dir =  V3.$( 0, 0,-1);
    var pos =  V3.$( 0, 0, config.closest);
    
    var rotMat;
    
    // only set the distance if it is valid
    if(config.distance <= config.farthest && config.distance >= config.closest){
      pos =  V3.$( 0, 0, config.distance);
      distance = config.distance;
    }
    
    /**
      Get the camera's transformation
      
      @return {Array} transformation matrix.
    */
    this.getMatrix = function(){
      return [left[0],  left[1],  left[2],  0,
              up[0],    up[1],    up[2],    0,
              dir[0],   dir[1],   dir[2],   0,
              0,        0,        0,        1];
    };
    
    /**
      Get the closest distance the camera can reside from the orbit point.
 
      @returns {float} The closest distance camera can reside from the orbit point.
    */
    this.__defineGetter__("closestDistance", function(){
      return closestDistance;
    });
    
    /**
      Get the farthest distance the camera can be from the orbit point
      
      @returns {Number} Farthest distance
    */
    this.__defineGetter__("farthestDistance", function(){
      return farthestDistance;
    });
    
    /**
      Get the point which the camera will orbit around.
     
       @returns {Number} orbit point
    */
    this.__defineGetter__("orbitPoint", function(){
      return orbitPoint;
    });
    
    /**
      Get the current distance from the orbit point.
      
      @return {Number} Distance from the orbit point.
    */
    this.__defineGetter__("distance", function(){    
      return V3.length(V3.sub(pos, orbitPoint));
    });
    
    /**
      Get the camera position.
      
      @return {Array} Array of three values.
    */
    this.__defineGetter__("pos", function(){    
      return pos;
    });
    
    /**
      Get the direction of the camera.
      
      @return {Array} Array of three values.
    */
    this.__defineGetter__("dir", function(){
      return dir;
    });
    
    /**
      Get the camera's up vector.
      
      @return {Array} Array of three values.
    */
    this.__defineGetter__("up", function(){    
      return [up[0], up[1], up[2]];
    });

    /**
      Get the camera's left vector.
      
      @return {Array} Array of three values.
    */
    this.__defineGetter__("left", function(){    
      return left;
    });
    
    /**
      Move the camera close to the orbit point. If it can't move 'distance'
      closer, it will move as close to the orbit point as it can.
      
      @param {Number} distance to move closer to the orbit point. Must be greater than zero.
    */
    this.goCloser = function(distance){
    
      // A negative value for goCloser() could be allowed and would
      // mean moving farther using a positive value, but this could
      // create some confusion and is therefore not permitted.
      if (distance > 0){
        var shiftAmt = V3.scale(dir, distance);
        var temp = V3.sub(pos, orbitPoint);

        var maxMoveCloser = V3.length(temp) - closestDistance;
          
        if (V3.length(shiftAmt) <= maxMoveCloser){
          pos = V3.add(pos, shiftAmt);
        }
      }
    };
        
    /**
      Move the camera 'distance' away from the orbit point relative to where
      the camera is positioned. The camera will not move if attempted to move
      farther than the farthest distance.

      @param {Number} distance Must be greater than zero.
    */
    this.goFarther = function(distance){
      // A negative value for goFarther() could be allowed and would
      // mean moving closer using a positive value, but this could
      // create some confusion and is therefore not permitted.
      if (distance > 0){
        var shiftAmt = V3.scale(V3.scale(dir, -1), distance);
        var newpos = V3.add(pos, shiftAmt);
        var distanceBetweenCamAndOP = V3.length(V3.sub(newpos, orbitPoint));
        if (distanceBetweenCamAndOP <= farthestDistance){
          pos = V3.clone(newpos);
        }
      }
    };

    /**
      Set the camera 'distance' away from the orbit point. The distance
      must be a value between the getClosestDistance() and getFarthestDistance().

      @param {float} distance
    */
    this.setDistance = function(distance){
      if (distance >= closestDistance && distance <= farthestDistance){
        // place the camera at the orbit point, then go farther.
        pos = V3.clone(orbitPoint);
        this.goFarther(distance);
      }
    };
    
    /**
      Create a new closest distance
      
      @param {Number} distance
    */
    this.setClosestDistance = function(distance){
      if (distance >= 0 && distance <= farthestDistance){
        closestDistance = distance;

        // The camera may now be too close, so back it up if necessary.
        var distanceBetweenCamAndOP = distance;

        // check if the camera's position has been invalidated.
        if (distanceBetweenCamAndOP < closestDistance){
        
          // find how much to back up the camera
          var amt = closestDistance - distanceBetweenCamAndOP;

          // Back the camera up to the new closest distance.
          this.goFarther(amt);
        }
      }
    };

    /**
      Set the farthest distance the camera can move away from the orbit point.

      If 'distance' is less than the current distance the camera is from
      the orbit point, the camera will be pulled in to the new closest
      distance.

      @param {Number} distance Must be less than or equal to getClosestDistance().
    */
    this.setFarthestDistance = function(distance){
      if (distance >= closestDistance){
        farthestDistance = distance;

        // The camera may be too far from the orbit point, so bring it closer.
        var distanceBetweenCamAndOP = distance;

        // Check if the camera's position has been invalidated.
        if (distanceBetweenCamAndOP > farthestDistance){
        
          // Find how much to back up the camera.
          var amt = distanceBetweenCamAndOP - farthestDistance;
          
          // bring it closer.
          this.goCloser(amt);
        }
      }
    };


    /**
      Pitch the camera about the orbit point.
      
      @param {Number} angle in radians.
    */
    this.pitch = function(angle){
      // Get the angle between the camera position and the global up axis
      var angleFromGlobalUp = V3.angle(V3.scale(dir, -1), [0,1,0]);
      var angleFromGlobalDown = Math.PI - angleFromGlobalUp;

      // Prevent the user from pitching past the global up axis              
      if(angle > 0 && angle > angleFromGlobalUp){
        angle = angleFromGlobalUp;
      }
      else if(angle < 0 && Math.abs(angle) > angleFromGlobalDown){
        angle = -angleFromGlobalDown;
      }

      // If the position of the camera is sitting at the orbit point,
      // we don't actually move the camera.
      if(V3.equals(pos, orbitPoint)){
        rotMat = M4x4.makeRotate(angle, left);
        dir = V3.normalize(V3.mul4x4(rotMat, dir));            
        up = V3.normalize(V3.cross(dir, left));
      }
      else{
        // Get the position relative to orbit point.
        pos = V3.sub(pos, orbitPoint);
        rotMat = M4x4.makeRotate(angle, left);
        
        // The position of the camera will actually change when pitching.
        var newpos = V3.mul4x4(rotMat, pos);
        pos = V3.add(newpos, orbitPoint);
        
        dir = V3.normalize(V3.sub(orbitPoint, pos));
        up = V3.normalize(V3.cross(dir, left));
        left = V3.normalize(V3.cross(up, dir));
      }
    };
    
    /**
      Yaw the camera about the global up axis.
      
      @param {Number} angle in radians
    */
    this.yaw = function(angle){
      if(V3.equals(pos, orbitPoint)){
      
        rotMat = M4x4.makeRotate(angle, [0,1,0]);
        
        left = V3.normalize(V3.mul4x4(rotMat, left));
        up = V3.normalize(V3.mul4x4(rotMat, up));
        dir = V3.normalize(V3.cross(left, up));
      }
      else{
        var camPosOrbit = V3.sub(pos, orbitPoint);

        // Create a rotation matrix based on location and angle.
        // we will rotate about the global up axis.
        var rotMat = M4x4.makeRotate(angle, [0,1,0]);

        var newpos = V3.mul4x4(rotMat, camPosOrbit);
        pos = V3.add(newpos, orbitPoint);
        
        dir = V3.normalize(V3.sub(orbitPoint, pos));
        up = V3.normalize(V3.mul4x4(rotMat, up));
        left = V3.normalize(V3.cross(up, dir));
      }
    };
   
   
    /**
      Create a new orbit point.
      
      @param {Array} op New orbit point
    */
    this.setOrbitPoint = function(op){
      orbitPoint = V3.clone(op);
      
      // get the distance the camera was from the orbit point.
      var orbitPointToCam = V3.scale(dir, -distance);
      pos = V3.add(orbitPoint, orbitPointToCam);
    };
    
    /**
      Set the camera to a new position. The position must be between the closest
      and farthest distances.

      @param {Array} position The new position of the camera.
    */
    this.setPosition = function(p){
      var distFromNewPosToOP = V3.length(V3.sub(orbitPoint, p));

      // make sure the new position of the cam is between the min 
      // and max allowed constraints.	
      if(distFromNewPosToOP >= closestDistance && distFromNewPosToOP <= farthestDistance){
        pos = V3.clone(p);
        var camPosToOrbitPoint = V3.sub(orbitPoint, pos);

        // If the position was set such that the direction vector is parallel to the global
        // up axis, the cross product won't work. In that case, leave the left vector as it was.
        var res = V3.cross(camPosToOrbitPoint, V3.$(0, 1, 0));

        if(V3.equals(res, V3.$(0,0,0))){
          // set the direction
          dir = V3.normalize(camPosToOrbitPoint);
          // the left vector will be perpendicular to the global up
          // axis and direction.
          up = V3.cross(dir, left);
        }
        else{
          // set the direction
          dir = V3.normalize(V3.sub(orbitPoint, p));
          // the left vector will be perpendicular to the global up
          // axis and direction.
          left = V3.cross(V3.$(0, 1, 0), dir);
          up = V3.cross(dir, left);
        }
      }
    };
    
  }
  return OrbitCam;
}());
