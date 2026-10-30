import { useNavigate } from 'react-router-dom';
import { useStageConfig } from '../components/StageView';
import { useProfile, useSession } from '../store';

export function Landing() {
  const nav = useNavigate();
  const fresh = useSession((s) => s.fresh);
  const { done, name } = useProfile();
  useStageConfig({ shot: 'hero', live: false });

  const start = () => {
    fresh();
    nav('/setup'); // always the weigh-in; a returning boxer finds their saved values filled in
  };

  return (
    <div className="landing">
      <div className="ltitle">
        <h1 className="inked">Watch how<br />u Box</h1>
        <div className="inked mustard ltag">Boxing coach</div>
      </div>

      <div className="paper taped lede">
        <div className="label">{done && name ? `Welcome back, ${name}` : 'Step into the gym'}</div>
        <p>A coach that watches your lead arm, corrects your form and counts every punch. One watch, one phone, no cameras.</p>
      </div>

      <div className="lnotes">
        <div className="paper note"><b className="inked red">1</b><span>Weigh in</span></div>
        <div className="paper note"><b className="inked red">2</b><span>Strap on watch + phone</span></div>
        <div className="paper note"><b className="inked red">3</b><span>Throw hands</span></div>
      </div>

      <button className="btn startbtn taped" onClick={start}>Start session</button>
    </div>
  );
}
