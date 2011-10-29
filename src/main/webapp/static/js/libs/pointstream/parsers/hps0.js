/*
  Copyright (c) 2010  Seneca College
  MIT LICENSE
*/
/**
  @author:  Mickael Medel
            Andor Salga
  
  If the hps0 files have normals, there will be
  - 3 bytes for X
  - 3 bytes for Y
  - 3 bytes for Z
  
  - 1 byte for Red
  - 1 byte for Green
  - 1 byte for Blue
  
  If the hps0 files do NOT have normals, there will be
  
  - 2 bytes for X
  - 2 bytes for Y
  - 2 bytes for Z
  
  - 2 bytes for Red, Green and Blue
  
  <pre>
  <xml tags>
  <that have relevant>
  <information= about the file>
  Binary Data...
  (3 bytes for x, 3 bytes for y, 3 bytes for z and 3 bytes for rgb)
  ...
  ...
  ...
  ...
  location and color data end for points
  normal data start
  (every 3 bytes is compressed normal data)
  ...
  ...
  ...
  <more tags>
  <to close opening tags>
  <and provide more information>
  
  // HPS0  
  // <Level=0>
  // <BinaryCloud>
  // <Format=1>
  // <NumPoints= 11158 0 >
  // <SpotSize= 0.134696 >
  // <Min= -24.1075 -28.9434 -16.8786 >
  // <Max= -12.4364 -14.8525 -18.72375 >
  // ...\
  // ... }- binary data (vertices & colors)
  // .../
  // ...\
  // ... }- possibly more binary data (normals)
  // .../
  // </Level=0>
  // </PsCloudModel>
          
</pre>

*/
var HPS0Parser = (function(){

  /**
    @private
  */
  function HPS0Parser(config){
    
    var lastChunkSize = 0;
    var gotHeader = false;
    var numTotalPoints = 0;
    
    //
    var loadedInOneRequest = false;
    
    // If the PSI file does not have normals, the structure of the file
    // will be different and therefore we need to parse differently.
    var hasNormals = false;

    // If the PSI file has normals, we'll have 9 bytes for XYZ
    // and 3 for RGB. (12)
    // If the PSI does NOT have normals, we'll have 6 bytes for XYZ
    // and 2 for RGB. (8)
    // So when we're streaming in the bytes, we'll need to know what
    // parts are the vertices and which parts are the colors.
    var byteIncrement;
    
    // These will be set when the header data is read and used
    // when the values are being parsed.
    // Values to be used in decompression of HPS0 files.
    var diffX, diffY, diffZ;
    var xMin, yMin, zMin;
    var xMax, yMax, zMax;
    var scaleX, scaleY, scaleZ;

    const SFACTOR = 16777216; // 2^24
    const NFACTOR = -0.5 + 1024; // 2^10
    
    var last12Index;
    var startOfNextChunk = 0;

    // Start of the binary data and the end of vertex and color data.
    var startOfBin;
    var endOfVertsCols;

    //
    var parsingVertsCols = true;

    // This will hold a reference to 
    // <Max ...>
    var maxTag;

    // Note: Firefox will call onprogress zero or many times
    // Chrome/WebKit will call onprogress one or many times
      
    /**
    */
    this.__defineGetter__("numTotalPoints", function(){
      return numTotalPoints;
    });
    
    
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
    var parseVertsCols = function(chunk, byteIdx, verts, cols){
      var byte1, byte2, twoBytes; // don't use short, that's reserved.
      var numBytes = chunk.length;
      
      for(var point = 0; point < numBytes/byteIncrement; byteIdx += byteIncrement, point++){
        // If the PSI file has normals, there are 3 bytes for each component.
        if(hasNormals){
          verts[point*3 + 0] = (diffX * getBytes3(chunk, byteIdx    )) / scaleX;
          verts[point*3 + 1] = (diffY * getBytes3(chunk, byteIdx + 3)) / scaleY;
          verts[point*3 + 2] = (diffZ * getBytes3(chunk, byteIdx + 6)) / scaleZ;

          cols[point*3 + 0] = getByte(chunk, byteIdx +  9) / 255;
          cols[point*3 + 1] = getByte(chunk, byteIdx + 10) / 255;
          cols[point*3 + 2] = getByte(chunk, byteIdx + 11) / 255;
        }
        else{
          verts[point*3 + 0] = (diffX * getBytes2(chunk, byteIdx    )) / scaleX;
          verts[point*3 + 1] = (diffY * getBytes2(chunk, byteIdx + 2)) / scaleY;
          verts[point*3 + 2] = (diffZ * getBytes2(chunk, byteIdx + 4)) / scaleZ;

          byte1 = getByte(chunk, byteIdx + 6);
          byte2 = getByte(chunk, byteIdx + 7);
         
          twoBytes = (byte2 << 8) + byte1;
          
          cols[point*3]     = (((twoBytes >> 10) & 0x1F) << 3)/255;
          cols[point*3 + 1] = (((twoBytes >> 5) & 0x1F) << 3)/255;
          cols[point*3 + 2] = ((twoBytes & 0x1F) << 3)/255;
        }
      }
    };
    
    /*
      @param {String} chunk
      @param {Number} numBytes
      @param {Number} byteIdx
      @param {ArrayBuffer} norms
    */
    var parseNorms = function(chunk, norms){
      var nzsign, nx11bits, ny11bits, ivalue;
      var nvec = new Float32Array(3);
      var byteIdx = 0;
      var numBytes = chunk.length;
      
      // Start reading the normals where we left off reading the
      // vertex positions and colors.
      // Each normal is 3 bytes.
      for(var point = 0; byteIdx < numBytes; byteIdx += 3, point += 3){

        ivalue = getBytes3(chunk, byteIdx);
        nzsign =   (ivalue >> 22) & 0x0001;
        nx11bits = (ivalue) & 0x07ff;
        ny11bits = (ivalue >> 11) & 0x07ff;
        
        if(nx11bits >= 0 && nx11bits < 2048 && ny11bits >= 0 && ny11bits < 2048){

          nvec[0] = (nx11bits/NFACTOR) - 1.0;
          nvec[1] = (ny11bits/NFACTOR) - 1.0;
          
          var nxnymag = nvec[0]*nvec[0] + nvec[1]*nvec[1];
          
          // Clamp values.
          nxnymag = Math.min(nxnymag, 1);
          nxnymag = Math.max(nxnymag,-1);
          nxnymag = 1 - nxnymag;

          nxnymag = Math.min(nxnymag, 1);
          nxnymag = Math.max(nxnymag,-1);
          
          nvec[2] = Math.sqrt(nxnymag);
          
          if (nzsign){
            nvec[2] = -nvec[2];
          }
          var dNorm = nvec[0]*nvec[0] + nvec[1]*nvec[1] + nvec[2]*nvec[2];
          
          dNorm = (dNorm > 0) ? Math.sqrt(dNorm) : 1;
          
          norms[point]   = nvec[0]/dNorm;
          norms[point+1] = nvec[1]/dNorm;
          norms[point+2] = nvec[2]/dNorm;
        }
      }
    };
    
    /**
    */
    var readHeader = function(textData){

      // Check if we have the entire Max tag, if we don't, we need to just 
      // wait around until the next XHR call is made and check again.
      // We need the entire max tag since it contain values which are used
      // to parse the vertices.
      var maxTagIdx = textData.indexOf("<Max=");
      if(maxTagIdx === -1){
        return;
      }
      
      // If we still haven't found it, we'll try again in the next call.
      var maxEndTag = textData.indexOf(">", maxTagIdx);
      if(maxEndTag === -1){
        return;
      }
      
      var numPtsIdx = textData.indexOf("<NumPoints=");
      var endTagIdx = textData.indexOf(">", numPtsIdx);
      
      // <NumPoints= 57507 2 0 57507 0 0 >
      var numPtsValuesStr = textData.substring((numPtsIdx + "<NumPoints=".length), endTagIdx);
      var numPtsValuesArr = numPtsValuesStr.split(" ");
      
      // Multiply by 1 to convert to a Number type.
      numTotalPoints = numPtsValuesArr[1] * 1;
      
      // We can find out if there are normals by inspecting <NumPoints>
      // <NumPoints= 11158 1 >
      // <NumPoints= 11158 2 >
      // If the second value is 0, the file does not contain normals.
      if((numPtsValuesArr[2] * 1) !== 0){
        hasNormals = true;
      }
      
      // Min tag contains the lowest bounding box values in the cloud which
      // are used for decompression.
      var minIdx = textData.indexOf("<Min=");
      
      var minEndTagIdx = textData.indexOf(">", minIdx);
      var temp = textData.substring((minIdx + "<Min=".length), minEndTagIdx);
      var posMinArr = temp.split(" ");
      
      // Multiply by 1 to convert to a Number type.
      xMin = posMinArr[1] * 1;
      yMin = posMinArr[2] * 1;
      zMin = posMinArr[3] * 1;
      
      // Max tag contains the highest bounding box values in the cloud which
      // are used for decompression.
      var maxIdx = textData.indexOf("<Max=");

      endTagIdx = textData.indexOf(">", maxIdx);
      temp = textData.substring((maxIdx + "<Max=".length), endTagIdx);
      var posMaxArr = temp.split(" ");
      
      // Multiply by 1 to convert to a Number type.
      xMax = posMaxArr[1] * 1;
      yMax = posMaxArr[2] * 1;
      zMax = posMaxArr[3] * 1;
      
      // Store the entire <Max= xx yy zz> tag
      maxTag = textData.substring(maxIdx, endTagIdx + 1);
      
      // Now we know exaxtly where the binary data begins
      // +2 bytes for offset values: \r\n
      // +1 is the byte after the \n
      infoStart = startOfBin = endTagIdx + 3;
      
      diffX = xMax - xMin;
      diffY = yMax - yMin;
      diffZ = zMax - zMin;

      scaleX = SFACTOR + xMin;
      scaleY = SFACTOR + yMin;
      scaleZ = SFACTOR + zMin;
      
      // If normals: 9 bytes for XYZ,  3 for RGB
      // otherwise: 6 for XYZ 2 for RGB  
      byteIncrement = hasNormals ? 12 : 8;
      
      endOfVertsCols = numTotalPoints * byteIncrement + infoStart;
      
      // If we got this far, we can start parsing values and we don't
      // have to try running this function again.
      gotHeader = true;
    };

    /**
      This is called once the entire file is done being downloaded.
    */
    this.onload = function(textData){
      if(!gotHeader){
        loadedInOneRequest = true;
      }
      // If we didn't read in the entire file in one request.
      return this.onprogress(textData);
    };
    
    /**
    */
    this.onprogress = function(textData){
      
      // This occurs at least on Firefox when working remotely.  
      if(lastChunkSize === textData.length){
        return;
      }
      
      lastChunkSize = textData.length;
      var chunkLength = textData.length;
      
      // The attributes which will be returned to the main PSI parser.
      var attributes = {};
      
      // If this is the first call to onprogress, try to read in the header.
      if(!gotHeader){
        readHeader(textData);
        
        // readHeader() will have attempted to read at least the <Min> and <Max>
        // tags, if we aren't that far in the file, we'll need to try again.
        if(!gotHeader){
          return;
        }
        // If this is the first time we read the file, start reading the binary data
        // at the start of the binary data rather than somewhere in the middle.
        startOfNextChunk = startOfBin;
      }
      var verts, cols, norms;
      var numVerts;
      var chunk;
      
      // Check if we have the entire file
      if(textData.indexOf("</Level=") > -1){
        last12Index = textData.indexOf("</Level=");
        var tagExists = textData.indexOf(maxTag);
        // +2 for offset values \n\r
        infoStart = tagExists + maxTag.length + 2;
      }
      else{
        // Find the last multiple of 12 in the chunk
        // this is because of the format shown at the top of this parser.
        var last12 = Math.floor((chunkLength - infoStart) / byteIncrement);
        last12Index = (last12 * byteIncrement) + infoStart;
      }
      
      var totalPointsInBytes = (numTotalPoints * byteIncrement) + infoStart;

      // If we are still only reading vertices and colors
      if(chunkLength < endOfVertsCols){
        chunk = textData.substring(startOfNextChunk, last12Index);

        startOfNextChunk = last12Index;
           
        numVerts = chunk.length/byteIncrement;
        verts = new Float32Array(numVerts * 3);
        cols  = new Float32Array(numVerts * 3);

        parseVertsCols(chunk, 0, verts, cols);
        attributes["ps_Vertex"] = verts;
        attributes["ps_Color"] = cols;
      }


      // If we downloaded the entire file in one request wer're going to read from
      // the start of the binary to end of verts/cols.
      
      // If we have more data than the end of the vertices and colors, but
      // our next read chunk is past the end of how much data we have.
      // This means we're in the middle of parsing vertices,colors and normals.
      
      // OR we're still parsing vertices and cols from last call.
      else if(startOfNextChunk < endOfVertsCols && last12Index > endOfVertsCols || loadedInOneRequest || parsingVertsCols ){
        chunk = textData.substring(startOfNextChunk, totalPointsInBytes);  
         
        if(hasNormals){
          parsingVertsCols = false;
        }

        startOfNextChunk = totalPointsInBytes;
         
        numVerts = chunk.length/byteIncrement;
        verts = new Float32Array(numVerts * 3);
        cols  = new Float32Array(numVerts * 3);
         
        parseVertsCols(chunk, 0, verts, cols);
        attributes["ps_Vertex"] = verts;
        attributes["ps_Color"] = cols;
      }
      // Parse the normals.
      if(!parsingVertsCols){
        chunk = textData.substring(startOfNextChunk, last12Index);
        
        norms = new Float32Array(chunk.length);

        startOfNextChunk = last12Index;
        parseNorms(chunk, norms);
        attributes["ps_Normal"] = norms;
      }
      /*jsl:ignore*/
      return attributes;
      /*jsl:end*/
    };
  }// ctor
  
  return HPS0Parser;
}());
