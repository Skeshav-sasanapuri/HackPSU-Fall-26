"""Generate a random test sequence + Python results of anat.apply_chain for every flag combination (JSON on stdout)."""
import itertools, json, os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'train'))
import anat
from mm import nrm

rng = np.random.default_rng(3)
T = 600
# forearm frame wanders; the 'model output' wanders and jitters so every limit actually engages
def walk(v, step):
    out = [v]
    for _ in range(T - 1):
        out.append(nrm(out[-1] + rng.normal(0, step, 3)))
    return np.array(out)

D = walk(nrm(rng.normal(size=3)), .05)
ref = walk(nrm(rng.normal(size=3)), .05)
N = nrm(ref - (ref * D).sum(1, keepdims=True) * D)
U = nrm(walk(nrm(rng.normal(size=3)), .12) + 0.6 * D + rng.normal(0, .05, (T, 3)))
P = dict(s=-1.0, phi_max=145.0, slack=12.0,
         lim=dict(phi_lo=8.0, phi_hi=100.0, p_c=60.0, p_lo=40.0, p_hi=70.0, p_full=False, dphi_max=90.0, vside_max=70.0))
cases = []
for bits in itertools.product([0, 1], repeat=len(anat.FLAG_NAMES)):
    fl = dict(zip(anat.FLAG_NAMES, bits))
    cases.append(dict(flags={k: bool(v) for k, v in fl.items()}, out=anat.apply_chain(U, D, N, P, fl).tolist()))
print(json.dumps(dict(P=P, U=U.tolist(), D=D.tolist(), N=N.tolist(), cases=cases)))
