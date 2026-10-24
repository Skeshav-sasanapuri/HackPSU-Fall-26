"""Shared pieces for the Motion Collector pipeline (loading, clocks, sensor decoding, features).

Everything that the live page must reproduce exactly lives in `features()` and `decode()`.
Frames: "world" = three.js style frame (+Y up) produced by the watch's game rotation vector.
        "heading frame" = world rotated about +Y by a yaw so that +Z is the calibration direction (arm held forward).
"""
import json
import numpy as np

AXES = {'12': (0., 1., 0.), '3': (1., 0., 0.), '6': (0., -1., 0.), '9': (-1., 0., 0.)}
LM = [0, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]   # landmarks stored per camera frame
LMI = {k: i for i, k in enumerate(LM)}
POSE_COLS = 3 + 6 * len(LM)          # r, ct, mt, then (wx,wy,wz,vis,ix,iy) per landmark
GRID_MS = 20.0                       # feature grid: 50 Hz, in WATCH time
G0 = 9.81
HPA_TO_M = 8.4
FEATURES = ['Dx', 'Dy', 'Dz', 'Nx', 'Ny', 'Nz', 'Wx', 'Wy', 'Wz', 'Ax', 'Ay', 'Az', 'h',
            'Wd', 'Wn', 'Wc', 'Ad', 'An', 'Ac']
NF = len(FEATURES)
FSCALE = np.array([1, 1, 1, 1, 1, 1, 4, 4, 4, 4, 4, 4, .5, 4, 4, 4, 4, 4, 4], dtype=np.float32)   # divide by this
BARO_FAST_S = 0.2       # smoothing of the raw pressure
BARO_SLOW_S = 15.0      # slow baseline that removes weather drift
SIDES = {'left': (11, 13, 15, 17, 19, 21), 'right': (12, 14, 16, 18, 20, 22)}   # shoulder elbow wrist pinky index thumb


def nrm(v, eps=1e-9):
    v = np.asarray(v, float)
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, eps)


def qrot(q, v):
    """rotate v by quaternion q=[x,y,z,w]; arrays (N,4),(N,3)"""
    x, y, z, w = q[:, 0], q[:, 1], q[:, 2], q[:, 3]
    t = np.stack([2 * (y * v[:, 2] - z * v[:, 1]), 2 * (z * v[:, 0] - x * v[:, 2]), 2 * (x * v[:, 1] - y * v[:, 0])], 1)
    return np.stack([v[:, 0] + w * t[:, 0] + (y * t[:, 2] - z * t[:, 1]),
                     v[:, 1] + w * t[:, 1] + (z * t[:, 0] - x * t[:, 2]),
                     v[:, 2] + w * t[:, 2] + (x * t[:, 1] - y * t[:, 0])], 1)


def to_three(v):
    return np.stack([v[:, 0], v[:, 2], -v[:, 1]], 1)


def yaw_rot(v, a):
    c, s = np.cos(a), np.sin(a)
    return np.stack([v[:, 0] * c + v[:, 2] * s, v[:, 1], -v[:, 0] * s + v[:, 2] * c], 1)


def decode(W, axis):
    """W: watch rows (N,>=13) -> dict of world-frame D (forearm axis), N (watch normal), W (gyro), A (linear accel)."""
    q = W[:, 3:7]
    q = np.stack([q[:, 0], q[:, 2], -q[:, 1], q[:, 3]], 1)
    q = q / np.linalg.norm(q, axis=1, keepdims=True)
    N = len(q)
    ax = np.tile(np.array(AXES[axis], float), (N, 1))
    D = nrm(qrot(q, to_three(ax)))
    n = qrot(q, np.tile([0., 1., 0.], (N, 1)))
    n = nrm(n - D * np.sum(n * D, 1, keepdims=True))
    w = qrot(q, to_three(W[:, 7:10]))
    a = qrot(q, to_three(W[:, 10:13])) - np.array([0., G0, 0.])
    return dict(D=D, N=n, W=w, A=a)


def load(path):
    with open(path) as f:
        j = json.load(f)
    S = dict(meta=j['meta'], marks=j.get('marks', []), path=str(path))
    S['watch'] = np.array(j['watch'], float).reshape(-1, 14)
    S['baro'] = np.array(j.get('baro', []), float).reshape(-1, 3)       # tp, p, r
    S['sync'] = np.array(j.get('sync', []), float).reshape(-1, 4)       # id, t0, t1, tw
    S['pose'] = np.array(j.get('pose', []), float).reshape(-1, POSE_COLS)
    S['hr'] = np.array(j.get('hr', []), float).reshape(-1, 2)
    return S


def clock_offset(sync, watch=None):
    """watch clock minus laptop clock, as a function of watch time.  Returns (fn, report)."""
    rep = {}
    if len(sync) >= 8:
        t0, t1, tw = sync[:, 1], sync[:, 2], sync[:, 3]
        rtt = t1 - t0
        off = tw - (t0 + t1) / 2
        keep = rtt <= max(np.percentile(rtt, 35), rtt.min() + 1.5)
        x, y = tw[keep], off[keep]
        if len(x) >= 6 and np.ptp(x) > 20000:
            for _ in range(3):
                p = np.polyfit(x - x[0], y, 1)
                res = y - np.polyval(p, x - x[0])
                s = max(res.std(), 0.3)
                ok = np.abs(res) < 3 * s
                x, y = x[ok], y[ok]
            x0 = x[0]
            fn = lambda t: np.polyval(p, t - x0)
            rep.update(method='pingpong+drift', n=int(len(x)), rtt_min=float(rtt.min()), rtt_med=float(np.median(rtt)),
                       resid_ms=float(res[ok].std()) if ok.any() else float(s), drift_ppm=float(p[0] * 1e6))
            return fn, rep
        c = float(np.median(y))
        rep.update(method='pingpong', n=int(len(x)), rtt_min=float(rtt.min()), rtt_med=float(np.median(rtt)),
                   resid_ms=float(np.std(y)), drift_ppm=0.0)
        return (lambda t: np.full_like(np.asarray(t, float), c)), rep
    if watch is not None and len(watch):    # fallback: receive times (jittery, +latency)
        c = float(np.percentile(watch[:, 0] - watch[:, 13], 5))
        rep.update(method='receive-time fallback (worse!)', n=0, rtt_min=np.nan, rtt_med=np.nan, resid_ms=np.nan, drift_ppm=0.0)
        return (lambda t: np.full_like(np.asarray(t, float), c)), rep
    raise ValueError('no clock information in this file')


def gauss_resample(t, V, grid, sigma, reach=3.0):
    """Gaussian kernel regression of samples (t,V) onto `grid` (ms). Returns values and coverage (sum of weights)."""
    V = np.asarray(V, float)
    if V.ndim == 1:
        V = V[:, None]
    out = np.zeros((len(grid), V.shape[1]))
    cov = np.zeros(len(grid))
    lo = np.searchsorted(t, grid - reach * sigma)
    hi = np.searchsorted(t, grid + reach * sigma)
    for i in range(len(grid)):
        a, b = lo[i], hi[i]
        if b > a:
            w = np.exp(-0.5 * ((t[a:b] - grid[i]) / sigma) ** 2)
            sw = w.sum()
            out[i] = (w[:, None] * V[a:b]).sum(0) / sw
            cov[i] = sw
    return out, cov


def interp_vec(t, V, grid):
    V = np.asarray(V, float)
    return np.stack([np.interp(grid, t, V[:, k]) for k in range(V.shape[1])], 1)


def gap_mask(t, grid, max_gap):
    """True where the grid time is inside a gap in t longer than max_gap (ms)."""
    j = np.searchsorted(t, grid)
    j = np.clip(j, 1, len(t) - 1)
    return (t[j] - t[j - 1]) > max_gap


def features(S, axis, yaw, grid):
    """Feature rows at watch-time `grid` (ms). Mirrors liveFeatures() in shared.js exactly.
    Returns F (len(grid), NF) float32 and `bad` (True where the watch stream had a gap)."""
    Wt = S['watch']
    dec = decode(Wt, axis)
    t = Wt[:, 0]
    tg, ta = t + Wt[:, 1], t + Wt[:, 2]
    D = interp_vec(t, yaw_rot(dec['D'], yaw), grid)
    N = interp_vec(t, yaw_rot(dec['N'], yaw), grid)
    Wv = interp_vec(tg, yaw_rot(dec['W'], yaw), grid)
    A = interp_vec(ta, yaw_rot(dec['A'], yaw), grid)
    D, N = nrm(D), nrm(N)
    h = baro_height(S['baro'], grid)
    C = np.cross(D, N)
    f = np.concatenate([D, N, Wv, A, h[:, None],
                        np.sum(Wv * D, 1, keepdims=True), np.sum(Wv * N, 1, keepdims=True), np.sum(Wv * C, 1, keepdims=True),
                        np.sum(A * D, 1, keepdims=True), np.sum(A * N, 1, keepdims=True), np.sum(A * C, 1, keepdims=True)], 1)
    bad = gap_mask(t, grid, 60.0)
    return f.astype(np.float32), bad


def baro_height(B, grid):
    """Causal pressure -> relative height (m): fast smoothing minus slow baseline, evaluated on the grid recursion."""
    if len(B) < 5:
        return np.zeros(len(grid))
    p = np.interp(grid, B[:, 0], B[:, 1])
    dt = GRID_MS / 1000.0
    kf, ks = 1 - np.exp(-dt / BARO_FAST_S), 1 - np.exp(-dt / BARO_SLOW_S)
    fast = np.empty(len(p)); slow = np.empty(len(p))
    fast[0] = slow[0] = p[0]
    for i in range(1, len(p)):
        fast[i] = fast[i - 1] + (p[i] - fast[i - 1]) * kf
        slow[i] = slow[i - 1] + (p[i] - slow[i - 1]) * ks
    return -(fast - slow) * HPA_TO_M


def ang(a, b):
    return np.degrees(np.arccos(np.clip(np.sum(nrm(a) * nrm(b), -1), -1, 1)))


def joint_share(U, D, dt, win):
    """share of the hand's motion that comes from the shoulder: w_u / (w_u + |phi_dot|), noise-robust:
    directions are smoothed over ~0.2 s, rates measured over 0.1 s, then averaged over `win` steps"""
    def sm(V, n=11):
        k = np.ones(n) / n
        return nrm(np.stack([np.convolve(np.pad(V[:, i], (n // 2, n // 2), mode='edge'), k, 'valid') for i in range(3)], 1))
    U, D = sm(U), sm(D)
    h = 5
    du = ang(U[h:], U[:-h]) / (h * dt)
    phi = ang(U, D)
    dp = np.abs(phi[h:] - phi[:-h]) / (h * dt)
    k = np.ones(win) / win
    su, sp = np.convolve(du, k, 'same'), np.convolve(dp, k, 'same')
    sh = np.concatenate([su / (su + sp + 1e-6), np.zeros(h)])
    return sh, np.concatenate([su + sp, np.zeros(h)])
