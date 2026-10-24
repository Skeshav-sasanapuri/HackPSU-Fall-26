#!/usr/bin/env python3
"""Train the real-time arm model from prepared sessions and export it for the browser.

    python prepare.py ../data/*.json                 # once per session file (alignment + targets)
    python train.py --test s06                       # train on every other session, report on s06 (never seen)
    python train.py --test s06 --no-baro             # ablation: does the barometer help?
    python train.py --include-test                   # final model: train on everything (do this last)

The model is a small causal GRU: it only looks at the past, one 50 Hz step at a time, so what you evaluate here is exactly
what runs live in the browser (laptop/live.html loads laptop/model.json).
"""
import argparse, glob, json, os, sys, time
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as Fn
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mm
from mm import nrm, ang, joint_share
import anat

HERE = os.path.dirname(os.path.abspath(__file__))
WIN, WARM = 200, 25
PRIOR_P0 = [45.0]


def derive(F):
    """recompute the 6 projected features from D,N,W,A (columns 0..11) after augmentation"""
    D, N, W, A = F[:, 0:3], F[:, 3:6], F[:, 6:9], F[:, 9:12]
    C = np.cross(D, N)
    F[:, 13] = (W * D).sum(1); F[:, 14] = (W * N).sum(1); F[:, 15] = (W * C).sum(1)
    F[:, 16] = (A * D).sum(1); F[:, 17] = (A * N).sum(1); F[:, 18] = (A * C).sum(1)
    return F


def load_sessions(names, root):
    out = []
    for n in names:
        z = np.load(os.path.join(root, 'cache', n + '.npz'), allow_pickle=True)
        side = json.loads(str(z['report'])).get('side', 'left')
        out.append(dict(name=n, F=z['F'].astype(np.float32), Y=z['Y'].astype(np.float32), V=z['V'].astype(bool), T=z['T'],
                        blk=z['blk'], bn=list(z['blk_names']), DC=z['DC'], side=side))
    return out


def chunks(sess, stride):
    X, Y, M = [], [], []
    for s in sess:
        n = len(s['F'])
        for a in range(0, n - WIN + 1, stride):
            m = s['V'][a:a + WIN]
            if m[WARM:].mean() < 0.6:
                continue
            X.append(s['F'][a:a + WIN]); Y.append(s['Y'][a:a + WIN]); M.append(m)
    return np.array(X), np.array(Y), np.array(M)


def augment(X, rng, yaw_deg, baro):
    X = X.copy()
    for i in range(len(X)):
        F = X[i]
        a = np.radians(np.clip(rng.normal(0, yaw_deg / 2), -yaw_deg, yaw_deg))
        for c in (0, 3, 6, 9):
            F[:, c:c + 3] = mm.yaw_rot(F[:, c:c + 3].astype(float), a)
        F[:, 6:9] += rng.normal(0, .02, 3)                       # gyro bias
        F[:, 9:12] += rng.normal(0, .25, 3)                      # accelerometer / tilt leakage bias
        F[:, 9:12] += rng.normal(0, .12, F[:, 9:12].shape)       # accelerometer noise
        F[:, 12] = F[:, 12] * rng.uniform(.6, 1.4) + rng.normal(0, .02, len(F))
        if not baro or rng.random() < .2:
            F[:, 12] = 0
        derive(F)
    return X


def build(nf=mm.NF, hid=96):
    class Net(nn.Module):
        def __init__(s):
            super().__init__()
            s.inp = nn.Linear(nf, 64); s.gru = nn.GRU(64, hid, batch_first=True)
            s.h1 = nn.Linear(hid, 64); s.out = nn.Linear(64, 3)
        def forward(s, x, h0=None):
            z = Fn.relu(s.inp(x)); o, h = s.gru(z, h0)
            return Fn.normalize(s.out(Fn.relu(s.h1(o))), dim=-1), h
    return Net()


def loss_fn(p, y, m):
    cos = (p * y).sum(-1)
    l = (1 - cos) + 0.5 * (p - y).norm(dim=-1)
    m = m.float(); m[:, :WARM] = 0
    return (l * m).sum() / m.sum().clamp(min=1)


def stream(net, F, scale, baro):
    X = F / scale
    if not baro:
        X = X.copy(); X[:, 12] = 0
    with torch.no_grad():
        p, _ = net(torch.from_numpy(X.astype(np.float32))[None])
    return p[0].numpy()


ROWS = [('+ preset hinge limits (hand-set 145 deg / half circle)', ('preset',)),
        ('+ learned: bend range', ('bend',)),
        ('+ learned: forearm-side range', ('side',)),
        ('+ learned: bend-speed limit', ('vbend',)),
        ('+ learned: twist-speed limit', ('vside',)),
        ('+ all four learned', anat.LEARNED),
        ('+ preset and all four learned', anat.FLAG_NAMES)]


def evaluate(net, sess, scale, baro, title, P):
    print(f'\n=== {title}')
    allp = {k: [] for k in ['model'] + [r[0] for r in ROWS] + ['anatomy-only estimator (LazyIK)', 'arm-straight (u = forearm)', 'constant mean pose']}
    feas = []
    cls = {k: [] for k in ('model', 'camera')}
    byblk = {}
    mu = nrm(np.concatenate([s['Y'][s['V']] for s in sess]).mean(0))
    for s in sess:
        p = stream(net, s['F'], scale, baro)
        v = s['V']
        e_model = ang(p, s['Y'])
        sg = P['s']
        for nm_, fl_ in ROWS:
            pp = anat.apply_chain(p, s['F'][:, 0:3], s['F'][:, 3:6], P, {k: 1 for k in fl_})
            allp[nm_].append(ang(pp, s['Y'])[v])
        feas.append(anat.feasible(p, s['F'][:, 0:3], s['F'][:, 3:6], sg)[v])
        allp['anatomy-only estimator (LazyIK)'].append(ang(anat.LazyIK(sg, p0_deg=PRIOR_P0[0]).run(s['F']), s['Y'])[v])
        e_arm = ang(s['F'][:, 0:3], s['Y'])
        e_const = ang(np.tile(mu, (len(p), 1)), s['Y'])
        allp['model'].append(e_model[v]); allp['arm-straight (u = forearm)'].append(e_arm[v]); allp['constant mean pose'].append(e_const[v])
        for bi, nm in enumerate(s['bn']):
            m = (s['blk'] == bi) & v
            if m.sum() > 50:
                byblk.setdefault(nm, []).append((e_model[m], e_arm[m]))
        # which joint moved?
        sh_t, act_t = joint_share(s['Y'], s['DC'], .02, 50)
        sh_p, act_p = joint_share(p, s['F'][:, 0:3], .02, 50)
        for bi, nm in enumerate(s['bn']):
            kind = 'elbow' if nm.startswith('elbow') else 'shoulder' if nm.startswith('shoulder') else None
            if not kind:
                continue
            m = (s['blk'] == bi) & v & (act_t > 25)
            if m.sum() < 50:
                continue
            for key, sh in (('model', sh_p), ('camera', sh_t)):
                got = np.where(sh[m] > .5, 'shoulder', 'elbow')
                cls[key].append((got == kind).mean())
    print(f"{'':60s}median   mean    90th pct   (error of the upper-arm direction, degrees)")
    for k, a in allp.items():
        a = np.concatenate(a)
        print(f'  {k:58s} {np.median(a):6.1f} {a.mean():7.1f} {np.percentile(a, 90):9.1f}')
    a = np.concatenate(allp['model'])
    print(f"  raw model outputs that already satisfy the preset hinge limits: {100 * np.concatenate(feas).mean():.0f}%")
    print(f'  -> elbow position error ~ {100 * 0.30 * 2 * np.sin(np.radians(np.median(a)) / 2):.1f} cm median (30 cm upper arm)')
    print('  per block (model median / arm-straight median, degrees):')
    for nm, lst in sorted(byblk.items()):
        em = np.concatenate([x[0] for x in lst]); ea = np.concatenate([x[1] for x in lst])
        print(f'    {nm:24s} {np.median(em):5.1f} / {np.median(ea):5.1f}')
    if cls['camera']:
        print(f"  'which joint is moving' on the elbow-only / shoulder-only blocks: model {100 * np.mean(cls['model']):.0f}% right"
              f"  (camera ground truth itself: {100 * np.mean(cls['camera']):.0f}%)")
    return {k: float(np.median(np.concatenate(v))) for k, v in allp.items()}


def export(net, path, extra):
    sd = {k: v.detach().numpy() for k, v in net.state_dict().items()}
    r = lambda a: np.round(a.astype(np.float64), 6).tolist()
    j = dict(version=1, nf=mm.NF, features=mm.FEATURES, scale=mm.FSCALE.tolist(), grid_ms=mm.GRID_MS, hid=int(sd['gru.weight_hh_l0'].shape[1]),
             inp_w=r(sd['inp.weight']), inp_b=r(sd['inp.bias']), w_ih=r(sd['gru.weight_ih_l0']), w_hh=r(sd['gru.weight_hh_l0']),
             b_ih=r(sd['gru.bias_ih_l0']), b_hh=r(sd['gru.bias_hh_l0']), h1_w=r(sd['h1.weight']), h1_b=r(sd['h1.bias']),
             out_w=r(sd['out.weight']), out_b=r(sd['out.bias']), baro_fast_s=mm.BARO_FAST_S, baro_slow_s=mm.BARO_SLOW_S,
             hpa_to_m=mm.HPA_TO_M, **extra)
    with open(path, 'w') as f:
        json.dump(j, f)
    print(f'exported {path} ({os.path.getsize(path) / 1024:.0f} KB)')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=os.path.join(HERE))
    ap.add_argument('--sessions', nargs='*')
    ap.add_argument('--test', nargs='*', default=None, help='sessions held out for the final report (default: the last one)')
    ap.add_argument('--include-test', action='store_true', help='train on everything (final model)')
    ap.add_argument('--no-baro', action='store_true')
    ap.add_argument('--epochs', type=int, default=60)
    ap.add_argument('--hid', type=int, default=96)
    ap.add_argument('--yaw-jitter', type=float, default=8.0)
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--device', default='auto', help='auto (GPU if available), cuda or cpu')
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'laptop', 'model.json'))
    a = ap.parse_args()
    torch.manual_seed(a.seed); rng = np.random.default_rng(a.seed)
    dev = torch.device('cuda' if (a.device == 'auto' and torch.cuda.is_available()) else 'cpu' if a.device == 'auto' else a.device)
    if dev.type == 'cuda':
        torch.cuda.manual_seed_all(a.seed)
        print('training on GPU:', torch.cuda.get_device_name(0))
    else:
        print('training on CPU' + ('  (torch.cuda.is_available() is False: install the CUDA build of torch to use the GPU, see README)' if a.device == 'auto' else ''))
    names = a.sessions or sorted(os.path.basename(p)[:-4] for p in glob.glob(os.path.join(a.root, 'cache', '*.npz')))
    if len(names) < 2 and not a.include_test:
        sys.exit('need at least 2 prepared sessions (one to train, one to test)')
    test = a.test if a.test is not None else [names[-1]]
    train_names = [n for n in names if n not in test] if not a.include_test else names
    print('train sessions:', train_names, '| held-out test:', [] if a.include_test else test, '| barometer:', not a.no_baro)
    tr = load_sessions(train_names, a.root)
    # validation = last 15% of each training session
    trs, vas = [], []
    for s in tr:
        k = int(len(s['F']) * .85)
        trs.append({**s, **{x: s[x][:k] for x in ('F', 'Y', 'V', 'blk', 'T', 'DC')}})
        vas.append({**s, **{x: s[x][k:] for x in ('F', 'Y', 'V', 'blk', 'T', 'DC')}})
    Xt, Yt, Mt = chunks(trs, 40)
    Xv, Yv, Mv = chunks(vas, 100)
    print(f'windows: train {len(Xt)}, validation {len(Xv)} ({WIN * 0.02:.0f} s each)')
    scale = mm.FSCALE
    net = build(hid=a.hid).to(dev)
    opt = torch.optim.AdamW(net.parameters(), lr=2e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=3e-3, total_steps=a.epochs * (len(Xt) // 64 + 1))
    best, best_state = 9e9, None
    Xv_t = torch.from_numpy((Xv / scale).astype(np.float32)).to(dev); Yv_t = torch.from_numpy(Yv).to(dev); Mv_t = torch.from_numpy(Mv).to(dev)
    Yt_d = torch.from_numpy(Yt).to(dev); Mt_d = torch.from_numpy(Mt).to(dev)
    if a.no_baro:
        Xv_t[:, :, 12] = 0
    t0 = time.time()
    for ep in range(a.epochs):
        net.train()
        Xa = augment(Xt, rng, a.yaw_jitter, not a.no_baro)
        perm = torch.from_numpy(rng.permutation(len(Xa))).to(dev); tl = 0; nb = 0
        Xa_d = torch.from_numpy((Xa / scale).astype(np.float32)).to(dev)
        for i in range(0, len(perm), 64):
            b = perm[i:i + 64]
            p, _ = net(Xa_d[b])
            l = loss_fn(p, Yt_d[b], Mt_d[b])
            opt.zero_grad(); l.backward(); nn.utils.clip_grad_norm_(net.parameters(), 1.0); opt.step(); sched.step()
            tl += l.item(); nb += 1
        net.eval()
        with torch.no_grad():
            pv, _ = net(Xv_t); vl = loss_fn(pv, Yv_t, Mv_t).item() if len(Xv) else tl / nb
        if vl < best:
            best, best_state = vl, {k: v.clone() for k, v in net.state_dict().items()}
        if ep % 5 == 0 or ep == a.epochs - 1:
            print(f'  epoch {ep:3d}  train {tl / nb:.4f}  validation {vl:.4f}  ({time.time() - t0:.0f}s)')
    net.load_state_dict(best_state); net = net.cpu(); net.eval()     # evaluation and export run on the CPU (exactly like the browser)
    for p_ in net.parameters():
        p_.requires_grad_(False)
    baro = not a.no_baro
    # which half-circle of the forearm the upper arm lives on: read it from the camera data, not assumed
    sgs = [anat.validate_arrays(s['Y'], s['F'][:, 0:3], s['F'][:, 3:6], s['V'], s['side'], verbose=False)[0] for s in tr]
    sg = float(np.sign(np.sum(sgs))) or anat.side_sign(tr[0]['side'])
    print(f'anatomy sign from the camera data: {sg:+.0f} (expected {anat.side_sign(tr[0]["side"]):+.0f} for the {tr[0]["side"]} wrist)')
    lim = anat.learn_limits(tr, sg)
    P = dict(s=sg, phi_max=anat.PHI_MAX, slack=anat.SLACK, lim=lim)
    print('LEARNED limits (measured from the camera data of the training sessions):')
    print(anat.describe_limits(lim, sg))
    evaluate(net, vas, scale, baro, 'validation (last 15% of each training session - same strap, same day, so optimistic)', P)
    med = None
    defaults_path = os.path.join(a.root, 'cache', 'anat_defaults.json')
    defaults = {k: False for k in anat.FLAG_NAMES}
    if not a.include_test:
        te = load_sessions(test, a.root)
        ins = anat.inside_stats(te, sg, lim)
        if ins:
            print('share of HELD-OUT camera frames that respect each learned limit (low = that limit does not carry over to a re-strapped session): '
                  + ', '.join(f'{k} {100 * v:.0f}%' for k, v in ins.items()))
        meds = evaluate(net, te, scale, baro, f'HELD-OUT TEST {test}  <- the honest number', P)
        med = meds['model']
        single = {'preset': '+ preset hinge limits (hand-set 145 deg / half circle)', 'bend': '+ learned: bend range', 'side': '+ learned: forearm-side range',
                  'vbend': '+ learned: bend-speed limit', 'vside': '+ learned: twist-speed limit'}
        defaults = {k: bool(meds[v] < med - 0.2) for k, v in single.items()}
        print('constraints that lowered the held-out error by 0.2 deg or more (these start switched ON in live.html; you can switch each one yourself):')
        print('   ' + ', '.join(f"{k}: {'ON' if v else 'off'} ({meds[single[k]] - med:+.1f} deg)" for k, v in defaults.items()))
        json.dump(defaults, open(defaults_path, 'w'))
    elif os.path.exists(defaults_path):
        defaults = json.load(open(defaults_path))
        print('constraint defaults taken from the last held-out run:', defaults)
    # parity vector for the browser test
    s0 = (load_sessions(test, a.root) if not a.include_test else tr)[0]
    seg = slice(500, 800)
    ref = stream(net, s0['F'][seg], scale, baro)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    export(net, a.out, dict(baro=baro, trained_on=train_names, test=[] if a.include_test else test, test_median_deg=med,
                            anat=dict(s=sg, phi_max=anat.PHI_MAX, slack=anat.SLACK, lim=lim, defaults=defaults),
                            parity=dict(X=np.round(s0['F'][seg], 5).tolist(), Y=np.round(ref, 5).tolist())))


if __name__ == '__main__':
    main()
