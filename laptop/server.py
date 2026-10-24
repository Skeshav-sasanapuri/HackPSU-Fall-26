#!/usr/bin/env python3
"""Motion Collector relay + file server.            pip install aiohttp numpy      then      python server.py

 - relays the watch's stream to the browser pages and the browser's clock pings back to the watch
 - serves collect.html (recording), live.html (real-time model) and mirror.html (the Motion Mirror mannequin driven by the trained model)
 - saves recorded sessions to ../data/ and runs the alignment check on them right away
 - on first start downloads MediaPipe (pose model + wasm) and three.js into laptop/assets/ so everything then works offline
"""
import asyncio, json, mimetypes, os, pathlib, re, socket, subprocess, sys, urllib.request
from aiohttp import web, WSMsgType

PORT = 8770
HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
DATA = ROOT / 'data'
ASSETS = HERE / 'assets'
mimetypes.add_type('application/javascript', '.mjs')
mimetypes.add_type('application/wasm', '.wasm')

DOWNLOADS = {
    'vision_bundle.mjs': 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs',
    'wasm/vision_wasm_internal.js': 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm/vision_wasm_internal.js',
    'wasm/vision_wasm_internal.wasm': 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm/vision_wasm_internal.wasm',
    'wasm/vision_wasm_nosimd_internal.js': 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm/vision_wasm_nosimd_internal.js',
    'wasm/vision_wasm_nosimd_internal.wasm': 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm/vision_wasm_nosimd_internal.wasm',
    'pose_landmarker_full.task': 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
    'pose_landmarker_heavy.task': 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
    'three.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
}

watches, viewers, phones = set(), set(), set()


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        return s.getsockname()[0]
    except OSError:
        return 'localhost'
    finally:
        s.close()


def ensure_assets():
    for rel, url in DOWNLOADS.items():
        p = ASSETS / rel
        if p.exists() and p.stat().st_size > 1000:
            continue
        p.parent.mkdir(parents=True, exist_ok=True)
        print(f'downloading {rel} ...', end=' ', flush=True)
        try:
            urllib.request.urlretrieve(url, p)
            print(f'{p.stat().st_size / 1e6:.1f} MB')
        except Exception as e:
            print('FAILED:', e)
            if p.exists():
                p.unlink()
            print(f'   -> download it by hand from {url}\n      and save it as {p}')


async def send_all(targets, text):
    for t in list(targets):
        try:
            await t.send_str(text)
        except Exception:
            pass


async def announce():
    await send_all(viewers, json.dumps({'event': 'watch', 'up': bool(watches)}))
    await send_all(viewers, json.dumps({'event': 'phone', 'up': bool(phones)}))


async def ws_handler(request):
    ws = web.WebSocketResponse(heartbeat=15, max_msg_size=8 * 1024 * 1024)
    await ws.prepare(request)
    role = request.query.get('role')
    is_watch, is_phone = role == 'watch', role == 'phone'     # a phone (strapped on the upper arm) is a second sensor source
    group = watches if is_watch else phones if is_phone else viewers
    name = 'watch' if is_watch else 'phone' if is_phone else 'browser'
    group.add(ws)
    print(name, 'connected:', request.remote)
    if is_watch or is_phone:
        await announce()
    else:
        await ws.send_str(json.dumps({'event': 'watch', 'up': bool(watches)}))
        await ws.send_str(json.dumps({'event': 'phone', 'up': bool(phones)}))
    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                await send_all(viewers if (is_watch or is_phone) else watches, msg.data)
    finally:
        group.discard(ws)
        print(name, 'disconnected')
        if is_watch or is_phone:
            await announce()
    return ws


def next_name():
    DATA.mkdir(exist_ok=True)
    n = 1
    while (DATA / f's{n:02d}.json').exists():
        n += 1
    return f's{n:02d}'


async def api_next(request):
    return web.json_response({'name': next_name(), 'existing': sorted(p.stem for p in DATA.glob('*.json'))} if DATA.exists()
                             else {'name': 's01', 'existing': []})


async def api_save(request):
    name = re.sub(r'[^A-Za-z0-9_-]', '', request.query.get('name', '')) or next_name()
    DATA.mkdir(exist_ok=True)
    path = DATA / f'{name}.json'
    if path.exists():                          # never overwrite a recording
        k = 2
        while (DATA / f'{name}_{k}.json').exists():
            k += 1
        path = DATA / f'{name}_{k}.json'
    body = await request.read()
    path.write_bytes(body)
    print(f'saved {path} ({len(body) / 1e6:.1f} MB)')
    report = None
    try:
        proc = await asyncio.create_subprocess_exec(sys.executable, '-I', str(ROOT / 'train' / 'prepare.py'), str(path), '--check', '--json',
                                                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        out, err = await asyncio.wait_for(proc.communicate(), 180)
        lines = [l for l in out.decode().splitlines() if l.startswith('{')]
        report = json.loads(lines[-1]) if lines else {'verdict': 'FAIL', 'flags': [err.decode()[-400:] or 'no output'], 'text': err.decode()[-800:]}
    except Exception as e:
        report = {'verdict': 'UNKNOWN', 'flags': [f'could not run the alignment check ({e}); install numpy: pip install numpy'], 'text': ''}
    if report:
        print('alignment check:', report.get('verdict'), report.get('flags'))
    return web.json_response({'ok': True, 'path': str(path), 'name': path.stem, 'report': report})


@web.middleware
async def no_cache(request, handler):
    resp = await handler(request)
    if request.path.endswith(('.html', '.js', '.json')) and not request.path.startswith('/assets/'):
        resp.headers['Cache-Control'] = 'no-store'
    return resp


async def index(request):
    raise web.HTTPFound('/collect.html')


def main():
    if '--no-download' not in sys.argv:
        ensure_assets()
    app = web.Application(middlewares=[no_cache], client_max_size=1024 ** 3)
    app.router.add_get('/ws', ws_handler)
    app.router.add_get('/api/next', api_next)
    app.router.add_post('/api/save', api_save)
    app.router.add_get('/', index)
    app.router.add_static('/', HERE, show_index=False)
    ip = lan_ip()
    print(f'\nCollect data:   http://localhost:{PORT}/collect.html')
    print(f'Live model:     http://localhost:{PORT}/live.html')
    print(f'Mirror (old mannequin + trained model):  http://localhost:{PORT}/mirror.html')
    print(f'Phone as upper-arm sensor (open ON THE PHONE, see README):  http://localhost:{PORT}/phone.html   (after: adb reverse tcp:{PORT} tcp:{PORT})')
    print(f'Watch app address (put this in MainActivity.kt):  ws://{ip}:{PORT}/ws?role=watch\n')
    web.run_app(app, host='0.0.0.0', port=PORT, print=None)


if __name__ == '__main__':
    main()
