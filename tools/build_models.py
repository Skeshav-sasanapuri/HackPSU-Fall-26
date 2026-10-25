# Blender (4.x) headless: merges each Mixamo character with the Mixamo animation clips into one GLB.
#   blender -b -P tools/build_models.py
# Output: app/public/models/<name>.raw.glb, then compress each one and delete the raw file:
#   npx @gltf-transform/cli@4 optimize male.raw.glb male.glb --compress meshopt --texture-compress webp --texture-size 512 --simplify false
import bpy, os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'assets-src')
OUT = os.path.join(ROOT, 'app', 'public', 'models')
BOXER = ['idle', 'jab', 'hook', 'uppercut', 'body_jab', 'block']
JOBS = {
    'male': ('character/male.fbx', BOXER),
    'female': ('character/female.fbx', BOXER),
    'coach': ('coach/coach.fbx', BOXER + ['coach_talking', 'coach_clapping']),
}

def anim_file(name):
    for f in os.listdir(os.path.join(SRC, 'animations')):
        if f.lower() == name + '.fbx':
            return os.path.join(SRC, 'animations', f)

def new_objects(before):
    return [o for o in bpy.data.objects if o.name not in before]

for name, (char, clips) in JOBS.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=os.path.join(SRC, char))
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    # skin: plain colour so the app can recolour it (drop MPFB's image texture)
    for m in bpy.data.materials:
        if m.name.lower().startswith('skin') and m.use_nodes:
            for n in list(m.node_tree.nodes):
                if n.type == 'TEX_IMAGE':
                    m.node_tree.nodes.remove(n)
    # the Mixamo round trip wires MPFB's hair/eye/brow textures into Alpha only: feed Base Color and Alpha from the
    # image again, and drop normal maps (the app's toon shading ignores them)
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        tex = next((n for n in nt.nodes if n.type == 'TEX_IMAGE'), None)
        for n in [n for n in nt.nodes if n.type == 'NORMAL_MAP']:
            nt.nodes.remove(n)
        if bsdf and tex:
            for l in list(nt.links):
                if l.to_node == bsdf and l.to_socket.name in ('Base Color', 'Alpha'):
                    nt.links.remove(l)
            nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
            nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
    arm.animation_data_create()
    for clip in clips:
        f = anim_file(clip)
        if not f:
            print('MISSING', clip); continue
        before = {o.name for o in bpy.data.objects}
        acts = set(bpy.data.actions)
        bpy.ops.import_scene.fbx(filepath=f)
        act = next(a for a in bpy.data.actions if a not in acts)
        act.name = clip
        act.use_fake_user = True
        tr = arm.animation_data.nla_tracks.new()
        tr.name = clip
        tr.strips.new(clip, int(act.frame_range[0]), act)
        tr.mute = True
        for o in new_objects(before):
            bpy.data.objects.remove(o, do_unlink=True)
    arm.animation_data.action = None
    # Mixamo does not embed textures: relink them from the MPFB export folders (assets-src/blend/*.fbm)
    for img in bpy.data.images:
        if img.has_data or img.packed_file:
            continue
        base = os.path.basename(bpy.path.abspath(img.filepath)) or img.name
        for d in os.listdir(os.path.join(SRC, 'blend')):
            cand = os.path.join(SRC, 'blend', d, base)
            if d.endswith('.fbm') and os.path.exists(cand):
                img.filepath = cand; img.reload(); break
        print('IMG', img.name, tuple(img.size))
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, name + '.raw.glb'), export_format='GLB',
        export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_frame_step=1,
        export_image_format='AUTO', export_yup=True, export_apply=True,
        export_morph=False)
    print('WROTE', name)
