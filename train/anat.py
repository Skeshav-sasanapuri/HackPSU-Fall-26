#!/usr/bin/env python3
"""Anatomical constraints for the arm (elbow = hinge, forearm = pivot, shoulder = ball and socket).

The geometry, in the forearm frame the watch gives us (d = forearm axis, n = watch normal = back of the wrist, c = d x n):

    upper arm direction   u = cos(phi) d + sin(phi) (cos(p) n + sin(p) s c)

      phi = elbow bend, 0 .. ~145 deg   (the elbow is a hinge: it can't bend backwards and can't bend sideways)
      p   = which way around the forearm the upper arm sits, limited to a HALF circle (about 0 .. 180 deg), because the
            forearm can only turn (pronate / supinate) about 180 deg relative to the upper arm.
      s   = -1 for the left wrist, +1 for the right (which half circle); validate() below checks it against camera data.

So the upper arm always lies in a cap around the forearm direction, on one side of the plane (d, n).
This is a feasibility region, not a unique answer: the shoulder can still explain the same forearm orientation with many
(phi, p) combinations. What the constraint does is remove the impossible ones.

Tools in this file
    project()   - snap an estimate (e.g. the network's output) onto the feasible region
    LazyIK      - estimator that explains rotation with the elbow/forearm first (they are cheap) and the shoulder second
    validate    - how often does the CAMERA ground truth satisfy the constraints? (if rarely, my model of the joint is wrong)

    python anat.py validate                  # on every prepared session in cache/
    python anat.py lazy --lam-phi 0.02       # standalone estimator, error vs camera
"""
import argparse, glob, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mm
from mm import nrm, ang, joint_share

PHI_MAX = 145.0     # deg, anatomical elbow flexion limit
SLACK = 12.0        # deg of tolerance (calibration error, carrying angle, watch not exactly on the axis)


def side_sign(side):
    return -1.0 if side == 'left' else 1.0


def cvec(d, n, s):
    return s * np.cross(d, n)


def feasible(u, d, n, s, phi_max=PHI_MAX, slack=SLACK):
    e = np.sum(u * cvec(d, n, s), -1)
    return (e >= -np.sin(np.radians(slack))) & (ang(u, d) <= phi_max + slack)


def project(u, d, n, s, phi_max=PHI_MAX, slack=SLACK):
    """nearest feasible upper-arm direction (vectorised; same maths as projectAnat() in shared.js)"""
    u = np.asarray(u, float); d = np.asarray(d, float); n = np.asarray(n, float)
    c = cvec(d, n, s)
    lim = np.sin(np.radians(slack))
    e = np.sum(u * c, -1, keepdims=True)
    u2 = np.where(e < -lim, nrm(u - (e + lim) * c), u)
    lo = np.radians(phi_max + slack)
    cosd = np.sum(u2 * d, -1, keepdims=True)
    over = np.arccos(np.clip(cosd, -1, 1)) > lo
    perp = nrm(u2 - cosd * d)
    u3 = np.cos(lo) * d + np.sin(lo) * perp
    return np.where(over, u3, u2)


def azimuth(u, d, n, s):
    """p (deg): where around the forearm the upper arm sits, 0 = on the back-of-wrist side (+n), increasing toward s*c"""
    c = cvec(d, n, s)
    return np.degrees(np.arctan2(np.sum(u * c, -1), np.sum(u * n, -1)))


def validate_arrays(U, D, N, V, side, verbose=True, name=''):
    out = {}
    for s in (-1.0, 1.0):
        ok = feasible(U, D, N, s)[V]
        out[s] = ok.mean()
    s_best = max(out, key=out.get)
    phi = ang(U, D)[V]
    bent = V & (ang(U, D) > 30)
    p = azimuth(U, D, N, s_best)[bent]
    if verbose:
        print(f"  {name:8s} camera truth satisfies the constraints: sign s=-1: {100 * out[-1.0]:.0f}%   s=+1: {100 * out[1.0]:.0f}%"
              f"   (expected best for the {side} wrist: s={side_sign(side):+.0f})   elbow bend median/95th: {np.median(phi):.0f}/{np.percentile(phi, 95):.0f} deg"
              f"   where the upper arm sits, 5th..95th pct: {np.percentile(p, 5):.0f}..{np.percentile(p, 95):.0f} deg")
    return s_best, out


class LazyIK:
    """Standalone estimator: state (phi, p). Each step the measured forearm rotation w is split into
    phi_dot * hinge + pronation * d + (whatever is left = shoulder), with a ridge penalty so the elbow/forearm are
    'cheaper' than the shoulder when lam is small.  phi and p are clamped to their limits."""
    def __init__(self, s, lam_phi=.02, lam_p=.05, leak=.05, phi_max=PHI_MAX, slack=SLACK, p0_deg=45.0):
        self.s, self.lp, self.lq, self.leak = s, lam_phi, lam_p, leak
        self.lo, self.hi = -np.radians(slack), np.pi + np.radians(slack)
        self.pm = np.radians(phi_max)
        self.phi, self.p = 0.0, np.radians(p0_deg)   # p cannot be read from the rotation rates alone: it starts at a prior and is then tracked

    def step(self, d, n, w, dt):
        c = self.s * np.cross(d, n)
        up = np.cos(self.p) * n + np.sin(self.p) * c            # direction of the upper arm around the forearm
        h = nrm(np.cross(up, d))                                # hinge axis
        A = np.stack([h, d], 1)
        x = np.linalg.solve(A.T @ A + np.diag([self.lp, self.lq]), A.T @ w)
        self.phi = float(np.clip(self.phi + x[0] * dt - self.leak * self.phi * dt, 0, self.pm))
        self.p = float(np.clip(self.p - self.s * x[1] * dt, self.lo, self.hi))
        up = np.cos(self.p) * n + np.sin(self.p) * c
        return np.cos(self.phi) * d + np.sin(self.phi) * up

    def run(self, F, dt=mm.GRID_MS / 1000):
        D, N, W = F[:, 0:3].astype(float), F[:, 3:6].astype(float), F[:, 6:9].astype(float)
        return np.array([self.step(D[i], N[i], W[i], dt) for i in range(len(F))])


# ======================================================================================================================
# LEARNED limits: every number below is measured from the camera ground truth of YOUR training sessions, nothing is
# hand-set except the safety margins. Four separate constraints, each can be switched on/off on its own:
#
#   bend    elbow bend phi (angle between upper arm and forearm) stays inside the range seen in the camera data
#   side    the upper arm stays inside the range of directions "around the forearm" (p) seen in the camera data
#           (this is the forearm-twist / which-side-the-elbow-folds rule, but learned instead of assumed)
#   vbend   the bend angle can't change faster than the fastest bend seen in the camera data
#   vside   the upper arm can't swing around the forearm faster than the fastest swing seen in the camera data
#
# All four work in the forearm frame (phi, p), i.e. they only restrict how the forearm and upper arm move RELATIVE to each
# other, which is the elbow + forearm joint. The shoulder (what the forearm does in the world) is never restricted.
# 'preset' is the older hand-set rule (phi <= 145+12 deg, upper arm on one side of the plane d,n) kept as its own switch.
# ======================================================================================================================
FLAG_NAMES = ('preset', 'bend', 'side', 'vbend', 'vside')
LEARNED = ('bend', 'side', 'vbend', 'vside')
MIN_PHI_FOR_P = np.radians(20)          # 'around the forearm' is only meaningful when the elbow is bent a bit
FADE_LO, FADE_HI = np.radians(5), np.radians(25)   # 'side' correction fades in between these bends (it is meaningless when straight)
MIN_SIN = np.sin(np.radians(10))        # twist-speed limit is relaxed when the arm is nearly straight


def wrap(a):
    a = np.asarray(a, float)
    return a - 2 * np.pi * np.floor((a + np.pi) / (2 * np.pi))


def split(u, d, n, s):
    """(phi, p, c): bend angle and azimuth of the upper arm in the forearm frame"""
    c = cvec(d, n, s)
    phi = np.arccos(np.clip(np.sum(u * d, -1), -1, 1))
    p = np.arctan2(np.sum(u * c, -1), np.sum(u * n, -1))
    return phi, p, c


def build(phi, p, d, n, c):
    return (np.cos(phi)[..., None] * d + (np.sin(phi) * np.cos(p))[..., None] * n + (np.sin(phi) * np.sin(p))[..., None] * c)


def learn_limits(sess, s, dt=mm.GRID_MS / 1000, pct=0.5, phi_margin=5.0, p_margin=10.0, rate_margin=1.3, min_frames=500):
    """measure the limits from camera ground truth (sess: dicts with Y, F, V). Returns a dict in degrees, or None."""
    PHI, P, DPHI, VS = [], [], [], []
    k = 4                                                     # rates are measured over 4 steps (80 ms) to stay clear of camera jitter
    for z in sess:
        U, D, N, V = z['Y'].astype(float), z['F'][:, 0:3].astype(float), z['F'][:, 3:6].astype(float), z['V']
        phi, p, _ = split(U, D, N, s)
        PHI.append(phi[V]); P.append(p[V & (phi > MIN_PHI_FOR_P)])
        ok = V[k:] & V[:-k]
        DPHI.append((np.abs(phi[k:] - phi[:-k]) / (k * dt))[ok])
        okp = ok & (phi[k:] > np.radians(10)) & (phi[:-k] > np.radians(10))
        VS.append((np.sin((phi[k:] + phi[:-k]) / 2) * np.abs(wrap(p[k:] - p[:-k])) / (k * dt))[okp])
    PHI, P, DPHI, VS = [np.concatenate(x) for x in (PHI, P, DPHI, VS)]
    if len(PHI) < min_frames or len(P) < min_frames // 2:
        return None
    pc = np.arctan2(np.sin(P).mean(), np.cos(P).mean())
    dev = np.degrees(wrap(P - pc))
    lo, hi = max(0.0, -np.percentile(dev, pct)) + p_margin, max(0.0, np.percentile(dev, 100 - pct)) + p_margin
    lim = dict(phi_lo=float(max(0.0, np.degrees(np.percentile(PHI, pct)) - phi_margin)),
               phi_hi=float(np.degrees(np.percentile(PHI, 100 - pct)) + phi_margin),
               p_c=float(np.degrees(pc)), p_lo=float(lo), p_hi=float(hi), p_full=bool(lo + hi >= 330),
               dphi_max=float(np.degrees(np.percentile(DPHI, 100 - pct)) * rate_margin) if len(DPHI) else 1e9,
               vside_max=float(np.degrees(np.percentile(VS, 100 - pct)) * rate_margin) if len(VS) > 50 else 1e9,
               n_frames=int(len(PHI)), n_bent=int(len(P)))
    return lim


def describe_limits(lim, s):
    if lim is None:
        return '  (not enough camera data to learn limits)'
    side = 'left' if s < 0 else 'right'
    return (f"  bend range         : {lim['phi_lo']:.0f} .. {lim['phi_hi']:.0f} deg   (elbow straight = 0)\n"
            f"  forearm-side range : upper arm sits {lim['p_c'] - lim['p_lo']:.0f} .. {lim['p_c'] + lim['p_hi']:.0f} deg around the forearm "
            f"(centre {lim['p_c']:.0f}; 0 = on the back-of-wrist side){'  [covers the whole circle: this constraint does nothing]' if lim['p_full'] else ''}\n"
            f"  bend speed limit   : {lim['dphi_max']:.0f} deg/s\n"
            f"  twist speed limit  : {lim['vside_max']:.0f} deg/s  (sideways swing of the upper arm around the forearm)\n"
            f"  learned from {lim['n_frames']} valid frames ({lim['n_bent']} with the elbow bent), {side} wrist, s={s:+.0f}")


def inside_stats(sess, s, lim):
    """what fraction of (e.g. held-out) camera frames respect the learned limits? low numbers = the limit does not generalise"""
    if lim is None:
        return {}
    R = {k: [] for k in LEARNED}
    k = 4
    for z in sess:
        U, D, N, V = z['Y'].astype(float), z['F'][:, 0:3].astype(float), z['F'][:, 3:6].astype(float), z['V']
        phi, p, _ = split(U, D, N, s)
        d = np.degrees(phi[V]); R['bend'].append((d >= lim['phi_lo']) & (d <= lim['phi_hi']))
        m = V & (phi > MIN_PHI_FOR_P)
        dev = np.degrees(wrap(p[m] - np.radians(lim['p_c'])))
        R['side'].append((dev >= -lim['p_lo']) & (dev <= lim['p_hi']))
        ok = V[k:] & V[:-k]
        R['vbend'].append((np.degrees(np.abs(phi[k:] - phi[:-k])) / (k * .02) <= lim['dphi_max'])[ok])
        okp = ok & (phi[k:] > np.radians(10)) & (phi[:-k] > np.radians(10))
        R['vside'].append((np.degrees(np.sin((phi[k:] + phi[:-k]) / 2) * np.abs(wrap(p[k:] - p[:-k]))) / (k * .02) <= lim['vside_max'])[okp])
    return {key: float(np.concatenate(v).mean()) if len(v) and sum(map(len, v)) else float('nan') for key, v in R.items()}


def apply_chain(U, D, N, P, flags, dt=mm.GRID_MS / 1000):
    """Apply the switched-on constraints to a whole output series U (T,3). P = dict(s, phi_max, slack, lim). Same maths, step by
    step, as AnatFilter in shared.js (checked by tests/parity_chain.js). Order: preset -> bend -> side -> speed limits."""
    s, lim = P['s'], P.get('lim')
    u = np.asarray(U, float).copy(); D = np.asarray(D, float); N = np.asarray(N, float)
    if flags.get('preset'):
        u = project(u, D, N, s, P.get('phi_max', PHI_MAX), P.get('slack', SLACK))
    if lim is None:
        return u
    rad = np.radians
    if flags.get('bend'):
        phi, p, c = split(u, D, N, s)
        phi2 = np.clip(phi, rad(lim['phi_lo']), rad(lim['phi_hi']))
        u = np.where((phi2 != phi)[:, None], build(phi2, p, D, N, c), u)
    if flags.get('side') and not lim['p_full']:
        phi, p, c = split(u, D, N, s)
        pc = rad(lim['p_c'])
        p2 = pc + np.clip(wrap(p - pc), -rad(lim['p_lo']), rad(lim['p_hi']))
        t = np.clip((phi - FADE_LO) / (FADE_HI - FADE_LO), 0, 1); w = (t * t * (3 - 2 * t))[:, None]
        u = nrm((1 - w) * u + w * build(phi, p2, D, N, c))
    if flags.get('vbend') or flags.get('vside'):
        phi, p, c = split(u, D, N, s)
        A, B = rad(lim['dphi_max']) * dt, rad(lim['vside_max']) * dt
        po, qo = phi.copy(), p.copy()
        pp, qq = phi[0], p[0]
        for i in range(len(phi)):
            f, g = phi[i], p[i]
            if flags.get('vbend'):
                dfi = f - pp
                if dfi > A: f = pp + A
                elif dfi < -A: f = pp - A
            if flags.get('vside'):
                dg = float(wrap(g - qq)); lp = min(np.pi, B / max(np.sin(f), MIN_SIN))
                if dg > lp: g = float(wrap(qq + lp))
                elif dg < -lp: g = float(wrap(qq - lp))
            po[i], qo[i] = f, g; pp, qq = f, g
        u = np.where(((po != phi) | (qo != p))[:, None], build(po, qo, D, N, c), u)
    return u


def load_cache(root):
    out = []
    for p in sorted(glob.glob(os.path.join(root, 'cache', '*.npz'))):
        z = np.load(p, allow_pickle=True)
        rep = __import__('json').loads(str(z['report']))
        out.append(dict(name=os.path.basename(p)[:-4], F=z['F'], Y=z['Y'], V=z['V'].astype(bool), blk=z['blk'], bn=list(z['blk_names']),
                        DC=z['DC'], side=rep.get('side', 'left')))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['validate', 'lazy'])
    ap.add_argument('--lam-phi', type=float, default=.02)
    ap.add_argument('--lam-p', type=float, default=.05)
    ap.add_argument('--p0', default='auto', help='starting position of the upper arm around the forearm, degrees (0..180), or auto')
    ap.add_argument('--root', default=os.path.dirname(os.path.abspath(__file__)))
    a = ap.parse_args()
    S = load_cache(a.root)
    if not S:
        sys.exit('no prepared sessions: run prepare.py first')
    if a.cmd == 'validate':
        print('Does the real (camera) arm obey the joint model? ')
        for s in S:
            validate_arrays(s['Y'], s['F'][:, 0:3], s['F'][:, 3:6], s['V'], s['side'], name=s['name'])
        print("\nIf the right sign is satisfied by 90%+ of frames, the constraint is sound. If not, tell me the numbers.")
    else:
        cands = [0, 45, 90, 135, 180] if a.p0 == 'auto' else [float(a.p0)]
        best = None
        for p0 in cands:
            es = []
            for s in S:
                U = LazyIK(side_sign(s['side']), a.lam_phi, a.lam_p, p0_deg=p0).run(s['F'])
                es.append(ang(U, s['Y'])[s['V']])
            med = np.median(np.concatenate(es))
            print(f'  p0 = {p0:5.0f} deg -> median error over all sessions {med:.1f} deg')
            if best is None or med < best[0]:
                best = (med, p0)
        print(f'best p0 = {best[1]:.0f} deg')
        for s in S:
            U = LazyIK(side_sign(s['side']), a.lam_phi, a.lam_p, p0_deg=best[1]).run(s['F'])
            e = ang(U, s['Y'])[s['V']]
            e_arm = ang(s['F'][:, 0:3], s['Y'])[s['V']]
            print(f"{s['name']}: LazyIK median {np.median(e):.1f} deg  mean {e.mean():.1f}  (arm-straight baseline median {np.median(e_arm):.1f})")

if __name__ == '__main__':
    main()
