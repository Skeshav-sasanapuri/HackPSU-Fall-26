#!/usr/bin/env python3
"""Align one recorded session and turn it into training data.

    python prepare.py ../data/s01.json            # check + write cache/s01.npz
    python prepare.py ../data/s01.json --check    # only print the alignment report (used by the collector page)

What "aligned" means here, step by step (each step prints what it found):
 1. CLOCKS   watch sensor time -> laptop time, from the ping/pong exchanges (best round trips, linear drift fit).
 2. CAMERA   the camera frames are stamped late by the webcam + MediaPipe pipeline.  The lag is measured from the data:
             forearm-direction SPEED seen by the watch vs seen by the camera, cross-correlated, sub-sample refined.
 3. FRAME    rotation between camera coordinates and the watch's world (Kabsch on the forearm direction).
 4. HEADING  the calibration pose (arm straight forward) defines "forward", exactly as the live page will do.
 5. TARGETS  upper-arm direction u (shoulder->elbow) and friends, smoothed and put on the 50 Hz watch-time grid.
"""
import argparse, json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mm
from mm import nrm, ang, LMI, SIDES

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache')
SIG = 35.0     # ms, smoothing of camera vectors


def lm(P, idx, k):
    i = LMI[idx]
    c = 3 + 6 * i
    return P[:, c:c + k]


def speeds(T, V, grid, sigma=SIG, half=30.0):
    Vs, cov = mm.gauss_resample(T, V, grid, sigma)
    Vs = nrm(Vs)
    a, _ = mm.gauss_resample(T, V, grid + half, sigma)
    b, _ = mm.gauss_resample(T, V, grid - half, sigma)
    return np.linalg.norm(nrm(a) - nrm(b), axis=1) / (2 * half / 1000.0), cov, Vs


def xcorr_lag(sw, sc, step_ms, lo=-150, hi=450):
    """lag L (ms) maximising corr(sw(T), sc(T+L)); parabolic refinement. Arrays on the same uniform grid."""
    best = (-2, 0)
    cs = {}
    for k in range(int(lo // step_ms), int(hi // step_ms) + 1):
        if k >= 0:
            a, b = sw[:len(sw) - k] if k else sw, sc[k:]
        else:
            a, b = sw[-k:], sc[:len(sc) + k]
        m = np.isfinite(a) & np.isfinite(b)
        if m.sum() < 200:
            continue
        a, b = a[m], b[m]
        a, b = a - a.mean(), b - b.mean()
        d = np.sqrt((a * a).sum() * (b * b).sum())
        c = (a * b).sum() / d if d > 0 else -2
        cs[k] = c
        if c > best[0]:
            best = (c, k)
    if not cs:
        return 0.0, 0.0
    c0, k0 = best
    if (k0 - 1) in cs and (k0 + 1) in cs:
        y0, y1, y2 = cs[k0 - 1], cs[k0], cs[k0 + 1]
        den = y0 - 2 * y1 + y2
        off = 0.5 * (y0 - y2) / den if abs(den) > 1e-9 else 0.0
        return (k0 + off) * step_ms, c0
    return k0 * step_ms, c0


def kabsch(C, Wd, iters=3):
    """rotation R with R @ c ~ w, trimmed least squares"""
    keep = np.ones(len(C), bool)
    for _ in range(iters):
        H = C[keep].T @ Wd[keep]
        U, _, Vt = np.linalg.svd(H)
        dd = np.sign(np.linalg.det(Vt.T @ U.T))
        R = Vt.T @ np.diag([1, 1, dd]) @ U.T
        err = ang(C @ R.T, Wd)
        thr = np.percentile(err, 80)
        keep = err <= max(thr, 5.0)
    return R, err


def segments(marks):
    """marks -> list of (name, r_start, r_end) in laptop ms"""
    open_, out = {}, []
    for m in marks:
        if m.get('k') == 'start':
            open_[m['name']] = m['r']
        elif m.get('k') == 'end' and m['name'] in open_:
            out.append((m['name'], open_.pop(m['name']), m['r']))
    return out


def prepare(path, check_only=False, quiet=False):
    log = []

    def say(s):
        log.append(s)
        if not quiet:
            print(s)

    S = mm.load(path)
    meta = S['meta']
    name = os.path.splitext(os.path.basename(path))[0]
    side = meta.get('side', 'left')
    ids = SIDES[side]
    axis = str(meta.get('axis', '3'))
    flags = []
    say(f"session {name}: side={side} axis={axis} camera={meta.get('camera')} strap={meta.get('strap')} "
        f"watch rows={len(S['watch'])} baro={len(S['baro'])} camera frames={len(S['pose'])}")
    if len(S['watch']) < 500 or len(S['pose']) < 100:
        raise SystemExit('not enough data in this file')

    # ---- 1. clocks
    Wt = S['watch']
    t = Wt[:, 0]
    off, crep = mm.clock_offset(S['sync'], Wt)
    Tl = t - off(t)                       # laptop time of every watch sample
    dur = (t[-1] - t[0]) / 1000
    hz = len(t) / dur
    gaps = np.diff(t)
    say(f"1. CLOCKS  {crep['method']}: {crep['n']} good exchanges, round trip min/median {crep['rtt_min']:.1f}/{crep['rtt_med']:.1f} ms, "
        f"residual {crep['resid_ms']:.1f} ms, drift {crep['drift_ppm']:.1f} ppm")
    say(f"   watch: {hz:.0f} Hz over {dur:.0f} s, longest gap {gaps.max():.0f} ms, gaps>40ms: {(gaps > 40).sum()}")
    lat = Wt[:, 13] - Tl      # laptop receive time minus the laptop time the sample was taken: should be a few to a few tens of ms
    say(f"   watch -> laptop transit: median {np.median(lat):.0f} ms, 95th percentile {np.percentile(lat, 95):.0f} ms")
    if np.median(lat) < -20 or np.median(lat) > 400:
        flags.append('sensor timestamps are not on the same clock as the ping replies (transit time is implausible)')
    if not crep['resid_ms'] <= 8:
        flags.append('clock sync is loose (residual > 8 ms)')
    if hz < 80:
        flags.append(f'watch rate low ({hz:.0f} Hz)')

    # ---- camera frames
    P = S['pose']
    r, ct = P[:, 0], P[:, 1]
    have = ct > 0
    stamp = np.where(have, ct, r - (np.median(r[have] - ct[have]) if have.any() else 0))
    order = np.argsort(stamp)
    P, stamp = P[order], stamp[order]
    s_i, e_i, w_i, pk_i, ix_i, th_i = ids
    Sh, El, Wr = lm(P, s_i, 3), lm(P, e_i, 3), lm(P, w_i, 3)
    vis = np.minimum(np.minimum(lm(P, s_i, 4)[:, 3], lm(P, e_i, 4)[:, 3]), lm(P, w_i, 4)[:, 3])
    L1, L2 = np.linalg.norm(El - Sh, axis=1), np.linalg.norm(Wr - El, axis=1)
    okf = (vis >= 0.5)
    if okf.sum() < 50:
        raise SystemExit('the arm was hardly visible to the camera')
    m1, m2 = np.median(L1[okf]), np.median(L2[okf])
    okf &= (np.abs(L1 / m1 - 1) < .25) & (np.abs(L2 / m2 - 1) < .25)
    say(f"   camera: {len(P) / ((stamp[-1] - stamp[0]) / 1000):.1f} fps, arm visible & plausible in {100 * okf.mean():.0f}% of frames, "
        f"upper arm {100 * m1:.0f} cm, forearm {100 * m2:.0f} cm (camera estimate)")
    if okf.mean() < .7:
        flags.append('arm visible in less than 70% of the camera frames')
    dc = nrm(Wr - El)

    # ---- 2. camera lag from speeds
    dec = mm.decode(Wt, axis)
    t0 = max(Tl[0], stamp[okf][0]) + 500
    t1 = min(Tl[-1], stamp[okf][-1]) - 1000
    G = np.arange(t0, t1, 10.0)
    Dw = mm.interp_vec(Tl, dec['D'], G)
    Tcam = stamp[okf]
    sc, cov, _ = speeds(Tcam, dc[okf], G)
    sw, _, _ = speeds(G, Dw, G)
    sc = np.where(cov > 0.5, sc, np.nan)
    lag, corr = xcorr_lag(sw, sc, 10.0)
    third = len(G) // 3
    l1, c1 = xcorr_lag(sw[:third * 2], sc[:third * 2], 10.0)
    l2, c2 = xcorr_lag(sw[third:], sc[third:], 10.0)
    say(f"2. CAMERA  frames are stamped {lag:.0f} ms late (speed correlation {corr:.2f}); first/second part of session: {l1:.0f}/{l2:.0f} ms")
    if corr < .6:
        flags.append(f'camera/watch motion correlation is weak ({corr:.2f}); the file may be unusable')
    if abs(l1 - l2) > 30:
        flags.append('camera lag changed during the session (>30 ms)')
    Tc = stamp - lag                      # corrected camera times (laptop clock)

    # ---- 3. frame between camera and watch world
    Dwc = mm.interp_vec(Tl, dec['D'], Tc)
    mv = okf & np.isfinite(Dwc).all(1) & (Tc > Tl[0]) & (Tc < Tl[-1])
    best = None
    for ax in (mm.AXES if meta.get('auto_axis', True) else [axis]):
        d2 = mm.decode(Wt, ax)
        Dx = mm.interp_vec(Tl, d2['D'], Tc)
        R, err = kabsch(dc[mv], Dx[mv])
        med = float(np.median(err))
        if best is None or med < best[0]:
            best = (med, ax, R, d2)
        if ax == axis:
            cur = (med, ax, R, d2)
    med, ax_best, R, dec2 = best
    if ax_best != axis and cur[0] - med > 3:
        flags.append(f"strap axis looks like '{ax_best}' not '{axis}' (error {med:.1f} vs {cur[0]:.1f} deg); using '{ax_best}'")
        axis, dec = ax_best, dec2
    else:
        med, axis, R, dec = cur
    say(f"3. FRAME   forearm direction seen by camera vs watch differs by median {med:.1f} deg after the best rotation (axis '{axis}')")
    if med > 25:
        flags.append(f'camera and watch forearm directions disagree by {med:.0f} deg')

    # ---- 4. heading from the calibration pose
    segs = segments(S['marks'])
    cal = [s for s in segs if s[0] == 'calib']
    if not cal:
        raise SystemExit("no 'calib' mark in this file (the collector adds it during the calibration pose)")
    _, ca, cb = cal[-1]
    sel = (Tl >= cb - 2000) & (Tl <= cb - 300)
    if sel.sum() < 30:
        raise SystemExit('calibration hold too short')
    dm = nrm(dec['D'][sel].mean(0))
    yaw = float(np.arctan2(-dm[0], dm[2]))
    say(f"4. HEADING calibration pose: forearm elevation {np.degrees(np.arcsin(dm[1])):.0f} deg, heading {np.degrees(yaw):.0f} deg "
        f"(should be roughly horizontal)")
    if abs(dm[1]) > 0.45:
        flags.append('during calibration the arm was not horizontal (>25 deg)')
    if np.degrees(np.std(dec['D'][sel][:, 1])) > 6:
        flags.append('arm moved during the calibration hold')

    # ---- 5. targets on the watch-time grid
    Sw = (R @ (El - Sh).T).T
    u_world = nrm(Sw)
    d_world = nrm((R @ (Wr - El).T).T)
    hand = nrm(((lm(P, ix_i, 3) + lm(P, pk_i, 3)) / 2 - Wr))
    h_world = nrm((R @ hand.T).T)
    grid = np.arange(t[0] + 1500, t[-1] - 500, mm.GRID_MS)
    Tg = grid - off(grid)
    kk = okf
    Ut, covu = mm.gauss_resample(Tc[kk], u_world[kk], Tg, SIG)
    Dt, _ = mm.gauss_resample(Tc[kk], d_world[kk], Tg, SIG)
    Ht, _ = mm.gauss_resample(Tc[kk], h_world[kk], Tg, SIG)
    covered = covu >= 1.0
    Uh = mm.yaw_rot(nrm(Ut), yaw)
    Dh_cam = mm.yaw_rot(nrm(Dt), yaw)
    Hh = mm.yaw_rot(nrm(Ht), yaw)
    F, bad = mm.features(S, axis, yaw, grid)
    # features() decodes with the axis given in meta; recompute if auto-axis changed it
    valid = covered & ~bad
    say(f"5. TARGETS {len(grid)} grid steps at 50 Hz, {100 * valid.mean():.0f}% have a trustworthy camera target")
    # sanity: how well does the watch's own forearm direction match the camera's after everything
    dres = ang(F[:, 0:3], Dh_cam)[valid]
    say(f"   final agreement of forearm direction (watch vs camera): median {np.median(dres):.1f} deg, 90th percentile {np.percentile(dres, 90):.1f} deg")
    # drift of heading over the session
    q = max(3, int(len(dres) // 6))
    per = [float(np.median(dres[i:i + q])) for i in range(0, len(dres) - q + 1, q)]
    say(f"   agreement by sixth of the session (deg): {' '.join(f'{x:.0f}' for x in per)}  (rising = heading drift)")
    if valid.mean() < .6:
        flags.append('fewer than 60% of steps have a camera target')

    # extras for later: joint angles
    elbow_flex = ang(Uh, Dh_cam)
    sh_flex = np.degrees(np.arctan2(Uh[:, 2], -Uh[:, 1]))
    sh_abd = np.degrees(np.arctan2(Uh[:, 0], -Uh[:, 1])) * (1 if side == 'left' else -1)
    wrist_flex = ang(Dh_cam, Hh)
    # blocks
    names = sorted({s[0] for s in segs})
    blk = np.full(len(grid), -1, np.int16)
    for nm, a, b in segs:
        blk[(Tg >= a) & (Tg <= b)] = names.index(nm)
    say(f"   blocks found: {len(names)} ({', '.join(names[:8])}{'...' if len(names) > 8 else ''})")

    verdict = 'PASS' if not flags else 'CHECK'
    say(f"RESULT: {verdict}" + ('' if not flags else ' - ' + '; '.join(flags)))
    rep = dict(session=name, verdict=verdict, flags=flags, lag_ms=float(lag), corr=float(corr), sync_resid_ms=float(crep['resid_ms']),
               hz=float(hz), frame_err_deg=float(med), agree_med=float(np.median(dres)), yaw_deg=float(np.degrees(yaw)),
               valid_frac=float(valid.mean()), L1=float(m1), L2=float(m2), axis=axis, side=side, text='\n'.join(log))
    if not check_only:
        os.makedirs(CACHE, exist_ok=True)
        np.savez_compressed(os.path.join(CACHE, name + '.npz'), F=F, Y=Uh.astype(np.float32), V=valid, T=grid, DC=Dh_cam.astype(np.float32),
                            blk=blk, blk_names=np.array(names), elbow_flex=elbow_flex.astype(np.float32),
                            sh_flex=sh_flex.astype(np.float32), sh_abd=sh_abd.astype(np.float32),
                            wrist_flex=wrist_flex.astype(np.float32), yaw=yaw, report=json.dumps(rep))
        say(f"   wrote cache/{name}.npz")
    return rep


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+', help='session files, globs, or a folder of them')
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--json', action='store_true', help='print only the report as JSON (for the collector page)')
    a = ap.parse_args()
    import glob
    files = []
    for f in a.files:
        if os.path.isdir(f):
            files += sorted(p for p in glob.glob(os.path.join(f, '*.json')) if not p.endswith('.truth.json'))
        else:
            files += sorted(glob.glob(f)) or [f]
    for f in files:
        try:
            rep = prepare(f, a.check, quiet=a.json)
            if a.json:
                print(json.dumps(rep))
        except SystemExit as e:
            msg = str(e)
            if a.json:
                print(json.dumps(dict(verdict='FAIL', flags=[msg], text=msg)))
            else:
                print('FAILED:', msg)
