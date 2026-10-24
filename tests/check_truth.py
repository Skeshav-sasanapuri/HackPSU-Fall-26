import json,sys,numpy as np
sys.path.insert(0,'/home/claude/trainer/train')
import mm
name=sys.argv[1]
z=np.load(f'/home/claude/trainer/train/cache/{name}.npz');tr=json.load(open(f'/home/claude/trainer/data_sim/{name}.truth.json'))
T=np.array(tr['truth']);S=mm.load(f'/home/claude/trainer/data_sim/{name}.json')
off,_=mm.clock_offset(S['sync'],S['watch'])
Tl=z['T']-off(z['T']);u=np.stack([np.interp(Tl,T[:,0],T[:,k]) for k in (1,2,3)],1)
v=z['V'];e=mm.ang(u,z['Y'])[v]
print('camera-target error vs exact truth: median %.1f deg, mean %.1f, p90 %.1f'%(np.median(e),e.mean(),np.percentile(e,90)))
print('lag true',tr['lag'],'; heading true %.1f deg vs found %.1f'%(np.degrees(tr['heading']),np.degrees(float(z['yaw']))))
# what would a 25 ms alignment error cost?  (shift targets)
