/*
  Copyright (c) 2010  Seneca College
  MIT LICENSE
*/
/**
  @class This is a sub parser used to parse PSI2 files.

  @author:  Andor Salga
            asalga.wordpress.com
*/
var PSI2Parser = (function(){

  /**
    @private
  */
  function PSI2Parser(config){
  
    var lastChunkSize = 0;
    var parsingVertsCols = true;
    
    var gotHeader = false;
    var numTotalPoints = 0;
    
    // If the PSI file has normals, this will be true.
    var hasNormals = false;
    
    // The number of bytes in the header, also where the binary data begins.
    var headerLength = 0;
    var startOfNextChunk;
    var last8Index;
        
    // The index where the vertices and colors end.
    var endOfVertsCols;
    
    // values to be used in decompression of PSI
    var diffX, diffY, diffZ;
    var xMin, yMin, zMin;
    var xMax, yMax, zMax;

    /**
    */
    this.__defineGetter__("numTotalPoints", function(){
      return numTotalPoints;
    });
    
    /**
    */
    var parseVertsCols = function(chunk, numBytes, byteIdx, verts, cols){
      var byte1, byte2, twoBytes; // don't use short, that's a reserved keyword.
      
      var numPoints = numBytes/8;
      
      for(var point = 0; point < numPoints; byteIdx += 8, point++){
        verts[point*3 + 0] = (diffX * getBytes2(chunk, byteIdx    ) / (32767*1000)) + xMin;
        verts[point*3 + 1] = (diffY * getBytes2(chunk, byteIdx + 2) / (32767*1000)) + yMin;
        verts[point*3 + 2] = (diffZ * getBytes2(chunk, byteIdx + 4) / (32767*1000)) + zMin;

        byte1 = getByte(chunk, byteIdx + 6);
        byte2 = getByte(chunk, byteIdx + 7);
       
        twoBytes = (byte2 << 8) + byte1;
        
        cols[point*3]     = (((twoBytes>>10) & 0x1F) << 3)/255;
        cols[point*3 + 1] = (((twoBytes>>5) & 0x1F) << 3)/255;
        cols[point*3 + 2] = ((twoBytes & 0x1F) << 3)/255;
      }
    };
    
    /**
    */
    var parseNorms = function(chunk, norms){
      var i,j,k,mag;
      
      for(var point = 0; point < chunk.length; point += 3){
        i = getByte(chunk, point  )/127 -1;
        j = getByte(chunk, point+1)/127 -1;
        k = getByte(chunk, point+2)/127 -1;
        
        mag = Math.sqrt(i*i + j*j + k*k);
        
        norms[point] =   i/mag;
        norms[point+1] = j/mag;
        norms[point+2] = k/mag;
      }
    };

    /**
      @private
      
      @param {String} str
      @param {Number} iOffset
    */
    var getByte = function(str, iOffset){
      return str.charCodeAt(iOffset) & 0xFF;
    };
    
    /**
      @private
      
      @param {String} str
      @param {Number} iOffset
    */
    var getBytes2 = function(str, iOffset){
      return ((getByte(str, iOffset + 1) << 8) + getByte(str, iOffset)) << 8;
    };

    /**
      @private
      
      @param {String} str
      @param {Number} iOffset - Must be an int.
      
      @returns
    */
    var getBytes3 = function(str, iOffset){
      return (((getByte(str, iOffset + 2) << 8) + getByte(str, iOffset + 1)) << 8) + getByte(str, iOffset);
    };

    /**
    */
    var readHeader = function(textData){
      
      // If we couldn't find the specular tag, we know we aren't
      // at the numPoints tag yet
      if(textData.indexOf("Specular") === -1){
        return;
      }

      // If we found a NoNormals string, turn off normals.
      var noNormalsIdx = textData.indexOf("NoNormals");
      hasNormals = noNormalsIdx === -1 ? true : false;

      // !! Change this to read up to the end of Specular
      var headerStr = textData.substring(0, 250);
      var headerArr = headerStr.split("\r\n");

      // When split, the header will look something like this:
      // [0] = "psi2:FrozenNormals|SingleCloud"
      // [1] = "-73.947 -106.653 -56.3939"
      // [2] = "88.7955 106.598 37.6935"
      // [3] = "69298 Points: SpotSize= 1.43808 : Specular= 18 1"
      // [4] = "F788,5>\0\b\uF7D0\\^,\uF7CD<!\f"  <-- our binary data

      for(var i = 0; i < 4; i++){
        headerLength += (headerArr[i].length + 2); // +2 for \r\n
      }
              
      var min = headerArr[1].split(" ");
      var max = headerArr[2].split(" ");

      numTotalPoints = headerArr[3].split(" ")[0] * 1;
      
      // Since this is so frequently used, calculate it once here.
      endOfVertsCols = numTotalPoints * 8 + headerLength;
      
      // Multiply by 1 to convert to a Number type.
      xMin = min[0] * 1;
      yMin = min[1] * 1;
      zMin = min[2] * 1;

      xMax = max[0] * 1;
      yMax = max[1] * 1;
      zMax = max[2] * 1;

      diffX = xMax - xMin;
      diffY = yMax - yMin;
      diffZ = zMax - zMin;
      
      gotHeader = true;
    };

    /**
      This will be called when the file is done being downloaded.
    */
    this.onload = function(textData){
    
      // If we downloaded the entire file in one request.
      if(!gotHeader){
        var verts,
            cols;
            
        readHeader(textData);
        // This contains our raw binary data.
        var binData = textData.substring(headerLength, endOfVertsCols);

        var attributes = {};
        verts = new Float32Array(numTotalPoints * 3);
        cols  = new Float32Array(numTotalPoints * 3);
        
        parseVertsCols(binData, binData.length, 0, verts, cols);
        
        attributes["ps_Vertex"] = verts;
        attributes["ps_Color"] = cols;

        // Parse the normals if we have them.
        if(hasNormals){
          // 5 for "end\r\n"
          var rawNormalData = textData.substring(endOfVertsCols, textData.length-5);

          var norms = new Float32Array(numTotalPoints * 3);
          parseNorms(rawNormalData, rawNormalData.length, 0, norms);
          attributes["ps_Normal"] = norms;
        }
        return attributes;
      }
      return this.onprogress(textData);
    };
    
    /**
    */
    this.onprogress = function(textData){
  
      // This occurs at least on Firefox when working remotely.  
      if(lastChunkSize === textData.length){
        return;
      }
      
      var chunk;
      var verts,
          cols,
          norms;
          
      lastChunkSize = textData.length;
      
      chunkLength = textData.length;
      
      var attributes = {};
      
      // If this is the first time this is getting called, read the header data.
      if(!gotHeader){
        readHeader(textData);
        
        if(!gotHeader){
          return;
        }
        
        startOfNextChunk = headerLength;
      }
      
      // Check if we have the entire file.
      // Consider changing this since this could be present in the binary data somewhere.
      if(textData.indexOf("End\r\n") > -1){
        last8Index = chunkLength - 5;
      }
      
      // If we aren't done the file.
      else{
        var last8;
        
        // If we're parsing the beginning part of the file
        if(parsingVertsCols){
          last8 = Math.floor((chunkLength - headerLength) / 8);
          last8Index = (last8 * 8) + headerLength;
        }
        else{
          last8 = Math.floor((chunkLength - endOfVertsCols) / 8);
          last8Index = (last8 * 8) + endOfVertsCols;
        }
      }
      
      // If we are still only reading vertices and colors.
      if(chunkLength < endOfVertsCols){
        chunk = textData.substring(startOfNextChunk, last8Index);
        
        // We'll start parsing in the next call where we left off.
        startOfNextChunk = last8Index;
        
        verts = new Float32Array(chunk.length/8 * 3);
        cols  = new Float32Array(chunk.length/8 * 3);

        parseVertsCols(chunk, chunk.length, 0, verts, cols);
        attributes["ps_Vertex"] = verts;
        attributes["ps_Color"] = cols;
      }
      
      // If we're in the middle of parsing vertices, colors and normals
      else if(chunkLength > endOfVertsCols && startOfNextChunk < endOfVertsCols){
        chunk = textData.substring(startOfNextChunk, endOfVertsCols);

        if(hasNormals){
          parsingVertsCols = false;
        }
        
        // We'll start parsing in the next call where we left off.
        startOfNextChunk = endOfVertsCols;

        var numVerts = chunk.length/8;
        verts = new Float32Array(numVerts * 3);
        cols  = new Float32Array(numVerts * 3);

        parseVertsCols(chunk, chunk.length, 0, verts, cols);
        attributes["ps_Vertex"] = verts;
        attributes["ps_Color"] = cols;
      }
      
      // If the file has normals and if we got enough of the file 
      // that we're now reading values AFTER the vertices and colors,
      // we're reading in normal data.
      if(!parsingVertsCols){
        chunk = textData.substring(startOfNextChunk, last8Index);
        startOfNextChunk = last8Index;
        
        norms  = new Float32Array(chunk.length);
        parseNorms(chunk, norms);
        attributes["ps_Normal"] = norms;
      }
      /*jsl:ignore*/
      return attributes;
      /*jsl:end*/
    };
  }// ctor
  
  return PSI2Parser;
}());
