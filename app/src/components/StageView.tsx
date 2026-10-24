import { ReactNode, useEffect, useRef } from 'react';
import { create } from 'zustand';
import { useArm } from '../hubContext';
import { Side } from '../scene/boxer';
import { Shot, getStage } from '../scene/stage';
import { useProfile } from '../store';

const other = (s: Side): Side => (s === 'L' ? 'R' : 'L');

/* One 3D gym behind every laptop screen. Screens say what they want (camera shot, ghost arm, live arm) and draw their
 * paper panels on top. */
export interface StageConfig { shot: Shot; ghost: boolean; live: boolean }
const useStageConfigStore = create<StageConfig & { set: (c: Partial<StageConfig>) => void }>((set) => ({
  shot: 'hero', ghost: false, live: true, set: (c) => set(c),
}));

export function useStageConfig(c: Partial<StageConfig>) {
  const set = useStageConfigStore((s) => s.set);
  useEffect(() => { set({ shot: 'hero', ghost: false, live: true, ...c }); }, [set, c.shot, c.ghost, c.live]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The canvas layer. Mounted once by the app shell. */
export function StageLayer() {
  const host = useRef<HTMLDivElement>(null);
  const arm = useArm();
  const lead = useProfile((p) => p.lead);
  const mirror = useProfile((p) => p.mirror);
  const { shot, ghost, live } = useStageConfigStore();
  const stage = getStage();

  useEffect(() => {
    stage.mount(host.current!);
    return () => stage.unmount();
  }, [stage]);

  useEffect(() => { stage.setShot(shot); }, [stage, shot]);

  useEffect(() => {
    const own: Side = lead === 'left' ? 'L' : 'R';
    const shown = mirror ? other(own) : own;
    stage.boxer.setLead(shown);
    return stage.onFrame((_dt, t) => {
      const pose = arm.tick(performance.now());
      const b = stage.boxer;
      if (pose && live) {
        const c = arm.toCharacter(pose, lead, mirror);
        b.driveArm(c.side, c.U, c.D, c.N);
        b.guard(other(c.side), t);
      } else {
        b.guard('L', t);
        b.guard('R', t);
      }
      stage.ghost.group.visible = ghost;
      if (ghost) stage.ghost.attach(b, shown);
    });
  }, [stage, arm, lead, mirror, ghost, live]);

  return (
    <>
      <div ref={host} className="stage-canvas" />
      <div className="stage-fx" />
    </>
  );
}

/** A full-stage screen: sets the stage up and lays HUD pieces over it. */
export function StageView({ shot, ghost = false, live = true, children }: { shot: Shot; ghost?: boolean; live?: boolean; children?: ReactNode }) {
  useStageConfig({ shot, ghost, live });
  return <div className="hud">{children}</div>;
}
