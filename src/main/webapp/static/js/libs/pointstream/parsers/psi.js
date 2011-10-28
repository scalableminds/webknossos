/*
  Copyright (c) 2010  Seneca College
  MIT LICENSE
*/
/**
  @class This parser parses .PSI filetypes. These files are Arius3D
  proprietary files which have their data stored as a mixture of
  ASCII and binary data.
  
  @version: 0.7
  @author:  Andor Salga
            asalga.wordpress.com
            Mickael Medel
            asydik.wordpress.com
                        
  Created:  February 2011
  Updated:  July 2011
*/
var PSIParser = (function() {

  /**
    @private
  */
  function PSIParser(config) {

    //
    var subParser;
    
    var __empty_func = function(){};
  
    var start = config.start || __empty_func;
    var parse = config.parse || __empty_func;
    var end = config.end || __empty_func;
    
    var version = "0.6";
    
    const UNKNOWN = -1;
    const XHR_DONE = 4;
    const STARTED = 1;
    
    const PSI2 = "psi2";
    const HPS0 = "hps0";

    var pathToFile = null;
    var fileSize = 0;
    
    // Filetype can be hps0 or psi2.
    var fileType;
    
    // The number of point we parsed so far.
    var numParsedPoints = 0;
    
    // The total number of points in the point cloud.
    var numTotalPoints = 0;
    
    // Progress ranges from 0 to 1.
    var progress = 0;
    
    // Length of the arrays we'll be sending the library.
    var BUFFER_SIZE = 30000;
    
    //
    var tempBufferV;
    var tempBufferOffsetV = 0;

    var tempBufferC;
    var tempBufferOffsetC = 0;

    var tempBufferN;
    var tempBufferOffsetN = 0;
    
    var AJAX = null;
    
    /**
      @private
      Get the type of PSI this file is. Can be HPS0, PSI2, etc.
    */
    var getFileType = function(textData){
      var type;
      
      // If we don't have enough bytes to find out what type of file it is, 
      // we'll have to wait until the next xhr request.
      if(textData.length < 6){
        return;
      }

      type = textData.substring(0, 4);
      if(type === "psi2"){
        fileType = PSI2;
        subParser = new PSI2Parser();
      }
      else{
        type = textData.substring(0, 6);
        if(type === "<hps0>"){
          fileType = HPS0;
          subParser = new HPS0Parser();
        }
      }
    };


    /**
      @private
      
      This function takes in a variable length array and chops it into
      equal sized parts since the library requires the array of attributes
      to be of equal size.
      
      Any excess values which don't entirely fit into the buffers created will
      be returned along with their length so the next iteration can fill them 
      up from there.
      
      @param {} arr
      @param {} tempBuffer
      @param {} tempBufferOffset
      @param {} Which attribute are we sending in? 1 = vertex, 2 = color, 3 = normal
      
      @returns {Object}
    */
    var partitionArray = function(arr, tempBuffer, tempBufferOffset, AttribID){
      // If we don't have enough for one buffer, just add it and wait for the next call.
      if(arr.length + tempBufferOffset < BUFFER_SIZE){
        // if this is the start of a new buffer
        if(!tempBuffer){
          tempBuffer = new Float32Array(BUFFER_SIZE);
          tempBuffer.set(arr);
        }
        // If the buffer already exists, we're going to be adding to it. Don't worry about
        // over filling the buffer since we already know at this point that won't happen.
        else{
          tempBuffer.set(arr, tempBufferOffset);
        }
        tempBufferOffset += arr.length;
      }
   
      // If what we have in the temp buffer and what we just parsed is too large for one buffer
      else if(arr.length + tempBufferOffset >= BUFFER_SIZE){
      
        // if temp buffer offset is zero, Find out how many buffers we can fill up with this set of vertices
        var counter = 0;
        var numBuffersToFill = parseInt(arr.length/BUFFER_SIZE, 10);
      
        // If there is something already in the buffer, fill up the rest.
        if(tempBufferOffset > 0){
          // Add the vertices from the last offset to however much we need to fill the temp buffer.
          var amtToFill = BUFFER_SIZE - tempBufferOffset;
          tempBuffer.set(arr.subarray(0, amtToFill), tempBufferOffset);
          
          switch(AttribID){
            case 1: numParsedPoints += BUFFER_SIZE/3;
                    parse(AJAX.parser, {"ps_Vertex": tempBuffer});break;
            case 2: parse(AJAX.parser, {"ps_Color":  tempBuffer});break;
            case 3: parse(AJAX.parser, {"ps_Normal": tempBuffer});break;
            default: break;
          }
          
          // now find out how many other buffers we can fill
          numBuffersToFill = parseInt((arr.length - amtToFill)/BUFFER_SIZE, 10);
          counter = amtToFill;
        }
        
        // Create and send as many buffers as we can with
        // this chunk of data.
        for(var buffIter = 0; buffIter < numBuffersToFill; buffIter++){
          var buffer = new Float32Array(BUFFER_SIZE);
          
          buffer.set(arr.subarray(counter, counter + BUFFER_SIZE));
 
          switch(AttribID){
            case 1: numParsedPoints += BUFFER_SIZE/3;
                    parse(AJAX.parser, {"ps_Vertex": buffer});break;
            case 2: parse(AJAX.parser, {"ps_Color":  buffer});break;
            case 3: parse(AJAX.parser, {"ps_Normal": buffer});break;
            default:break;
          }
          
          counter += BUFFER_SIZE;
        }
        
        // put the end of the attributes in the first part of the temp buffer
        tempBuffer = new Float32Array(BUFFER_SIZE);
        tempBuffer.set(arr.subarray(counter, counter + arr.length));
        tempBufferOffset = arr.length - counter;
      }
      
      // return the changes
      return {
        buffer: tempBuffer,
        offset: tempBufferOffset
      };
    };
    
    /**
      Returns the version of this parser
      @name PSIParser#version
      @returns {String} parser version
    */
    this.__defineGetter__("version", function(){
      return version;
    });
    
    /**
      Get the number of parsed points so far
      @name PSIParser#numParsedPoints
      @returns {Number} number of points parsed.
    */
    this.__defineGetter__("numParsedPoints", function(){
      return numParsedPoints;
    });
    
    /**
      Get the total number of points in the point cloud.
      @name PSIParser#numTotalPoints
      @returns {Number}
    */
    this.__defineGetter__("numTotalPoints", function(){
      if(subParser){
        subParser.numTotalPoints;
      }
    });
    
    /**
      Returns the progress of downloading the point cloud
      @name PSIParser#progress
      @returns {Number} value from zero to one or -1 if unknown.
    */
    this.__defineGetter__("progress", function(){
      return progress;
    });
    
    /**
      Returns the file size of the resource in bytes.
      @name PSIParser#fileSize
      @returns {Number} size of resource in bytes.
    */
    this.__defineGetter__("fileSize", function(){
      return fileSize;
    });
    
    /**
      Stop downloading and parsing the associated point cloud.
    */
    this.stop = function(){
      if(AJAX){
        AJAX.abort();
      }
    };
    
    /**
      @param {String} pathToFile
      
      The library is responsible for calling this method.
    */
    this.load = function(path){
      pathToFile = path;

      AJAX = new XMLHttpRequest();
      
      // put a reference to the parser in the AJAX object
      // so we can give the library a reference to the
      // parser within the AJAX event handler scope.
      // !! eventually need to fix this
      AJAX.parser = this;

      /**
        @private
        Occurs exactly once when the resource begins to be downloaded.
      */
      AJAX.onloadstart = function(evt){
        start(AJAX.parser);
      };
          
      /*
        Occurs exactly once, when the file is done being downloaded.
        
        Firefox/Minefield sometimes skips calling onprogress and 
        jumps to onload.
        
        @param {} evt
      */
      AJAX.onload = function(evt){
        var textData = AJAX.responseText;
        var o;
        
        // If we downloaded the file in one request.
        if(!fileType){
        
          // Depending on the filetype, we'll have to instantiate different sub parsers.
          getFileType(textData);

          var attributes = subParser.onload(textData);
          
          numParsedPoints = numTotalPoints = subParser.numTotalPoints;
          parse(AJAX.parser, attributes);
          
          // Indicate parsing is done. Ranges from 0 to 1.
          progress = 1;
          end(AJAX.parser);
          return;
        }

        // If we didn't get the entire file in one request, continue on...
        var attr = subParser.onload(textData);
        
        numTotalPoints = subParser.numTotalPoints;

        if(attr){
          if(attr.ps_Vertex){
            o = partitionArray(attr.ps_Vertex, tempBufferV, tempBufferOffsetV, 1);
            tempBufferV = o.buffer;
            tempBufferOffsetV = o.offset;
          }
          
          if(attr.ps_Color){
            o = partitionArray(attr.ps_Color, tempBufferC, tempBufferOffsetC, 2);
            tempBufferC = o.buffer;
            tempBufferOffsetC = o.offset;
          }
          
          if(attr.ps_Normal){
            o = partitionArray(attr.ps_Normal, tempBufferN, tempBufferOffsetN, 3);
            tempBufferN = o.buffer;
            tempBufferOffsetN = o.offset;
          }
        }
        
        // Get the last remaining bits from the temp buffers
        // and parse those too.
        if(tempBufferV && tempBufferOffsetV > 0){
          // Only send the data if there's actually something to send.
          var lastBufferV = tempBufferV.subarray(0, tempBufferOffsetV);
          numParsedPoints += tempBufferOffsetV/3;
          parse(AJAX.parser, {"ps_Vertex": lastBufferV});
        }
        
        if(tempBufferC && tempBufferOffsetC > 0){
          // Only send the data if there's actually something to send.
          var lastBufferC = tempBufferC.subarray(0, tempBufferOffsetC);
          parse(AJAX.parser, {"ps_Color": lastBufferC});
        }
        
        if(tempBufferN && tempBufferOffsetN > 0){
          // Only send the data if there's actually something to send.
          var lastBufferN = tempBufferN.subarray(0, tempBufferOffsetN);
          parse(AJAX.parser, {"ps_Normal": lastBufferN});
        }

        progress = 1;
        end(AJAX.parser);
      };
      
      /**
        @private
        
        On Firefox/Minefield, this will occur zero or many times
        On Chrome/WebKit this will occur one or many times
      */
      AJAX.onprogress = function(evt){
        var textData = AJAX.responseText;
        var o;
        
        // If there is nothing to parse, wait until there is.
        if(!textData || textData.length < 6){
          return;
        }
        
        // Update the file's progress.
        if(evt.lengthComputable){
          fileSize = evt.total;
          progress = evt.loaded/evt.total;
        }

        // If this is the first call to onprogress, get the file type.
        if(!fileType){
          getFileType(textData);
        }
        
        var attr = subParser.onprogress(textData);
        if(attr){
          if(attr.ps_Vertex){
            o = partitionArray(attr.ps_Vertex, tempBufferV, tempBufferOffsetV, 1);
            tempBufferV = o.buffer;
            tempBufferOffsetV = o.offset;
          }
          
          if(attr.ps_Color){
            o = partitionArray(attr.ps_Color, tempBufferC, tempBufferOffsetC, 2);
            tempBufferC = o.buffer;
            tempBufferOffsetC = o.offset;
          }
          
          if(attr.ps_Normal){
            o = partitionArray(attr.ps_Normal, tempBufferN, tempBufferOffsetN, 3);
            tempBufferN = o.buffer;
            tempBufferOffsetN = o.offset;
          }
        }
      };
      
      // This line is required since we are parsing binary data.
      if(AJAX.overrideMimeType){
        AJAX.overrideMimeType('text/plain; charset=x-user-defined');
      }
      // open an asynchronous request to the path
      AJAX.open("GET", path, true);

      AJAX.send(null);
    };// load
  }// ctor
  return PSIParser;
}());
