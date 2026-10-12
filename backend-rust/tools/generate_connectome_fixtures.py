"""Independent native HDF5 and Zarr3 CSR/CSC tables, with directed/self/external synapses.
UV_CACHE_DIR=/tmp/wk-rust-reader-uv uv run --offline --with h5py==3.15.1 --with numpy==2.3.4 python backend-rust/tools/generate_connectome_fixtures.py
"""
from pathlib import Path
import json
import h5py,numpy as np
OUT=Path(__file__).resolve().parents[2]/'backend-rust/datastore/tests/fixtures/connectomes'
OUT.mkdir(parents=True,exist_ok=True)
pairs=[];csr=[];columns=[];offsets=[0];srcs=[];dsts=[]
for src in range(8):
    csr.append(len(pairs))
    for dst in range(7):
        if src==7 or ((src+2*dst)%3==0 and not(src==dst and src in [2,4])):continue
        pairs.append((src,dst));columns.append(dst)
        count=(src+dst)%3+1;srcs.extend([src]*count);dsts.extend([dst]*count);offsets.append(len(srcs))
csr.append(len(pairs));csc=[];csc_pairs=[]
for dst in range(8):
    csc.append(len(csc_pairs));csc_pairs.extend(i for i,pair in enumerate(pairs) if pair[1]==dst)
csc.append(len(csc_pairs))
positions=np.array([[i*3,i*3+1,i*3+2] for i in range(len(srcs))],dtype='<u8');positions[-1,2]=2**64-1
types=np.array([i%3 for i in range(len(srcs))],dtype='u1');types[-1]=255
arrays={k:np.array(v,dtype='<u8') for k,v in {'CSR_indptr':csr,'CSR_indices':columns,'CSC_indptr':csc,'CSC_agglomerate_pair':csc_pairs,'agglomerate_pair_offsets':offsets,'synapse_to_src_agglomerate':srcs,'synapse_to_dst_agglomerate':dsts}.items()}
arrays.update(synapse_types=types,synapse_positions=positions)
for name,version,compressed,endian in [('contiguous','earliest',False,'<'),('chunked_v1','earliest',True,'>'),('chunked_v4','latest',True,'<')]:
    with h5py.File(OUT/f'{name}.hdf5','w',libver=version) as f:
        f.attrs['metadata/mapping_name']=np.bytes_('connectome_mapping') if compressed else 'connectome_mapping'
        for key,value in arrays.items():
            value=value.astype(value.dtype.newbyteorder(endian))
            opts=dict(chunks=(min(len(value),4),3) if value.ndim==2 else (min(len(value),4),),compression='gzip',shuffle=True,fletcher32=True) if compressed else {}
            f.create_dataset(key,data=value,**opts)
with h5py.File(OUT/'empty.hdf5','w') as f:f.attrs['metadata/mapping_name']='empty'
zarr=OUT/'zarr3';zarr.mkdir(exist_ok=True)
(zarr/'zarr.json').write_text(json.dumps(dict(zarr_format=3,node_type='group',attributes=dict(voxelytics=dict(artifact_schema_version=1,artifact_attributes=dict(mapping_name='connectome_mapping',synapse_type_names=['dendritic-shaft-synapse','spine-head-synapse','soma-synapse']))))))
for key,value in arrays.items():
    d=zarr/key;d.mkdir(exist_ok=True);dtype='uint8' if value.dtype.itemsize==1 else 'uint64'
    shape=list(value.shape)
    h=dict(zarr_format=3,node_type='array',shape=shape,data_type=dtype,chunk_grid=dict(name='regular',configuration=dict(chunk_shape=shape)),chunk_key_encoding=dict(name='default',configuration=dict(separator='/')),fill_value=0,codecs=[dict(name='bytes',configuration=dict(endian='little'))],attributes={})
    (d/'zarr.json').write_text(json.dumps(h));p=d/Path('c',*['0']*value.ndim);p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(value.tobytes())
(OUT/'tables.json').write_text(json.dumps({key:value.tolist() for key,value in arrays.items()},indent=2)+'\n')
# Noncanonical numeric storage accepted by the actual Scala readers; float conversion and
# signed MA widening are deliberately different from HDF5 uint64 numeric conversion.
import shutil
mixed=dict(arrays)
mixed['synapse_positions']=positions.astype('<f8');mixed['synapse_positions'][0]=[-1.75,float('inf'),float('nan')]
mixed['synapse_to_src_agglomerate']=np.array(srcs,dtype='<u4');mixed['synapse_to_src_agglomerate'][0]=2**32-1
mixed['synapse_types']=types.astype('<i2');mixed['synapse_types'][0]=-2
mixed['CSR_indices']=np.array(columns,dtype='<i4')
hdf_mixed=dict(mixed);hdf_mixed['synapse_positions']=positions.astype('<f8');hdf_mixed['synapse_positions'][0]=[1.,2.,3.];hdf_mixed['synapse_positions'][-1,2]=12.;hdf_mixed['synapse_types']=types.astype('<i2')
with h5py.File(OUT/'numeric.hdf5','w',libver='earliest') as f:
    f.attrs['metadata/mapping_name']='connectome_mapping'
    for key,value in hdf_mixed.items():f.create_dataset(key,data=value)
    f.create_dataset('float_fractional',data=np.array([1.75,2.9],dtype='<f8'))
    f.create_dataset('float_special',data=np.array([float('inf'),float('nan')],dtype='<f8'))
    f.create_dataset('float_whole',data=np.array([0.,1.,7.,2**63],dtype='<f8'))
numeric=OUT/'zarr_numeric';shutil.copytree(zarr,numeric,dirs_exist_ok=True)
for key in ['synapse_positions','synapse_to_src_agglomerate','synapse_types','CSR_indices']:
    d=numeric/key;h=json.loads((d/'zarr.json').read_text());h['data_type']={'synapse_positions':'float64','synapse_to_src_agglomerate':'uint32','synapse_types':'int16','CSR_indices':'int32'}[key]
    (d/'zarr.json').write_text(json.dumps(h));value=mixed[key];p=d/Path('c',*['0']*value.ndim);p.write_bytes(value.tobytes())
