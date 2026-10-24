import { useNavigate } from 'react-router-dom';
import { useProfile, useSession } from '../store';

export function Landing() {
  const nav = useNavigate();
  const fresh = useSession((s) => s.fresh);
  const { done, name } = useProfile();

  const start = () => {
    fresh();
    nav(done ? '/connect' : '/setup');
  };

  return (
    <main className="page">
      <section className="poster">
        <div>
          <h1>Throw<br />the <em>jab.</em></h1>
        </div>
        <div>
          <p className="lede">
            {done && name ? `Welcome back, ${name}. ` : ''}A coach that watches your lead arm, corrects your form and counts every punch.
            One watch, one phone, no cameras.
          </p>
          <button className="btn" onClick={start}>Start a session</button>
        </div>
      </section>

      <hr className="rule" />

      <section className="steps" aria-label="How it works">
        <div>
          <div className="n">1</div>
          <h3>Tell us who you are</h3>
          <p>Height and weight set your arm lengths and the power estimate.</p>
        </div>
        <div>
          <div className="n">2</div>
          <h3>Strap on two sensors</h3>
          <p>Phone on the bicep, watch on the wrist. Scan one code, type one code.</p>
        </div>
        <div>
          <div className="n">3</div>
          <h3>Hit the bag</h3>
          <p>Your boxer copies your arm in real time. Learn moves, then throw them.</p>
        </div>
      </section>
    </main>
  );
}
