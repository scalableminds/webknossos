"""Independent codecs/hash fixtures: uv run --with compressed-segmentation==2.3.3 --with mmh3==5.3.1 python this_file."""
from pathlib import Path
import json, struct
import numpy as np
import compressed_segmentation as codec
import mmh3
import importlib.metadata
root = Path(__file__).resolve().parents[1]/"datastore/tests/fixtures/precomputed"
root.mkdir(parents=True,exist_ok=True)
meta=[]
for name,dtype,shape,block in [("seg32",np.uint32,(5,4,3),(2,3,2)),("bits1",np.uint32,(5,4,3),(2,3,2)),("bits2",np.uint32,(5,4,3),(2,3,2)),("bits8",np.uint32,(5,4,3),(4,4,4)),("bits16",np.uint32,(8,8,8),(8,8,8)),("seg64",np.uint64,(5,4,3),(2,3,2)),("constant",np.uint64,(5,4,3),(2,3,2)),("multichannel",np.uint64,(5,4,3,2),(2,3,2))]:
    coords=np.indices(shape)
    values=np.asarray(sum(coords[d]*(13**d) for d in range(len(shape))),dtype=dtype,order="F")
    if name=="bits1": values%=2
    if name=="bits2": values%=4
    if dtype==np.uint64: values+=np.uint64(2**63+17)
    if name=="constant": values[:]=np.uint64(2**64-1)
    if name=="bits32": values=np.arange(np.prod(shape),dtype=dtype).reshape(shape,order="F")
    if len(shape)==4:
        # The binding's 4D path has layout quirks. Compose independently encoded native
        # channels, each verified by its 3D reference decoder, using the format's offset table.
        channels=[]
        for ch in range(shape[3]):
            channel=np.asarray(values[:,:,:,ch],order="F")
            single=codec.compress(channel,block_size=block,order="F")
            assert np.array_equal(codec.decompress(single,shape[:3],dtype,block_size=block,order="F"),channel)
            assert struct.unpack_from("<I",single)[0]==1
            channels.append(single[4:])
        offsets=[];offset=shape[3]
        for channel in channels: offsets.append(offset);offset+=len(channel)//4
        encoded=struct.pack("<"+"I"*len(offsets),*offsets)+b"".join(channels)
    else:
        encoded=codec.compress(values,block_size=block,order="F")
        decoded=codec.decompress(encoded,shape,dtype,block_size=block,order="F")
        assert np.array_equal(decoded,values),name
    (root/(name+".encoded")).write_bytes(encoded)
    (root/(name+".decoded")).write_bytes(values.astype(np.dtype(dtype).newbyteorder("<")).tobytes(order="F"))
    meta.append({"name":name,"volume":list(shape[:3]),"channels":1 if len(shape)==3 else shape[3],"block":list(block),"width":np.dtype(dtype).itemsize})
# Bounded explicit 32-bit packed-index case. The native large-cardinality encoder
# does not finish promptly; this fixture tests the specification's full-width bit mask.
(root/"bits32.encoded").write_bytes(struct.pack("<7I",1,(32<<24)|4,2,0,1,0xdeadbeef,0xfacefeed))
(root/"bits32.decoded").write_bytes(struct.pack("<2I",0xdeadbeef,0xfacefeed))
meta.append({"name":"bits32","volume":[2,1,1],"channels":1,"block":[2,1,1],"width":4})
(root/"segmentation.json").write_text(json.dumps(meta,indent=2)+"\n")
values=[0,1,2,31,2**32+17,2**63,2**64-1]+[int(x) for x in np.random.default_rng(42).integers(0,2**64,size=32,dtype=np.uint64)]
(root/"murmur.json").write_text(json.dumps([{"input":str(i),"hash":str(mmh3.hash128(struct.pack("<Q",i),seed=0,x64arch=False,signed=False)&(2**64-1))}for i in values],indent=2)+"\n")
(root/"oracle.json").write_text(json.dumps({"compressed-segmentation":importlib.metadata.version("compressed-segmentation"),"mmh3":importlib.metadata.version("mmh3"),"generator":"native compressed_segmentation and x86 mmh3 reference, seed=0, little-endian uint64 keys"},indent=2)+"\n")

# Independent specification writer for raw arrays/shards (negative delta offsets included).
import gzip
shape=(5,4,3);chunks=(2,3,2);voxel_offset=(5,7,11)
x,y,z=np.indices(shape);original=np.asarray(1+x+20*y+400*z,dtype='<u2',order='F')
for name,hash_name,mini_encoding,data_encoding in [('raw',None,'raw','raw'),('shard_identity','identity','raw','raw'),('shard_gzip','identity','gzip','gzip'),('shard_murmur','murmurhash3_x86_128','gzip','raw')]:
    target=root/name;scale=target/'1';scale.mkdir(parents=True,exist_ok=True)
    spec={'@type':'neuroglancer_uint64_sharded_v1','preshift_bits':0,'hash':hash_name,'minishard_bits':1,'shard_bits':2,'minishard_index_encoding':mini_encoding,'data_encoding':data_encoding}
    scale_meta={'key':'1','size':list(shape),'resolution':[1,1,1],'chunk_sizes':[list(chunks)],'encoding':'raw','voxel_offset':list(voxel_offset)}
    if hash_name:scale_meta['sharding']=spec
    (target/'info').write_text(json.dumps({'type':'image','data_type':'uint16','num_channels':1,'scales':[scale_meta]})+'\n')
    values=original.copy(order='F');groups={}
    grid=tuple((s+c-1)//c for s,c in zip(shape,chunks));bits=tuple((g-1).bit_length()for g in grid)
    for pos in np.ndindex(grid):
        start=tuple(i*c for i,c in zip(pos,chunks));end=tuple(min(s+c,n)for s,c,n in zip(start,chunks,shape));subset=tuple(slice(s,e)for s,e in zip(start,end))
        if pos in [(0,0,0),(2,1,1)]:values[subset]=0;continue
        payload=original[subset].tobytes(order='F')
        if hash_name:
            code=0;outbit=0
            for bit in range(max(bits)):
                for axis in range(3):
                    if bit<bits[axis]:code|=((pos[axis]>>bit)&1)<<outbit;outbit+=1
            hashed=code if hash_name=='identity'else mmh3.hash128(struct.pack('<Q',code),x64arch=False,signed=False)&(2**64-1)
            shard=(hashed>>1)&3;mini=hashed&1
            if data_encoding=='gzip':payload=gzip.compress(payload,mtime=0)
            groups.setdefault(shard,{}).setdefault(mini,[]).append((code,payload))
        else:
            filename='_'.join(f'{a+o}-{b+o}'for a,b,o in zip(start,end,voxel_offset))
            (scale/filename).write_bytes(payload)
    for shard,minis in groups.items():
        body=bytearray();stored={}
        # Put chunks in descending ID order. Sorted minishard indexes therefore contain
        # backward offset deltas, encoded modulo uint64 as required by the format.
        for mini,entries in minis.items():
            stored[mini]=[]
            for code,payload in sorted(entries,reverse=True):
                body.extend(b'PAD');offset=len(body);body.extend(payload);stored[mini].append((code,offset,len(payload)))
        table=bytearray()
        for mini in range(2):
            entries=sorted(stored.get(mini,[]));ids=[];offsets=[];sizes=[];last_id=0;last_end=0
            for code,offset,size in entries:
                ids.append((code-last_id)%(2**64));offsets.append((offset-last_end)%(2**64));sizes.append(size);last_id=code;last_end=offset+size
            encoded=b''.join(struct.pack('<Q',v)for row in [ids,offsets,sizes]for v in row)
            if mini_encoding=='gzip'and encoded:encoded=gzip.compress(encoded,mtime=0)
            start=len(body);body.extend(encoded);table.extend(struct.pack('<QQ',start,len(body)))
        (scale/f'{shard:01x}.shard').write_bytes(table+body)
    (target/'expected.bin').write_bytes(values[1:5,1:4,1:3].tobytes(order='F'))
