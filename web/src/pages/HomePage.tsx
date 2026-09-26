import { Link } from "react-router-dom";

export function HomePage() {
  return (
    <div className="home">
      <div className="home-inner">
        <p className="eyebrow">A storyteller&apos;s companion</p>
        <h1 className="brand">
          Blood on the
          <span>Clocktower</span>
        </h1>
        <i className="ornament" aria-hidden />
        <p>When the sun dies and the town wakes hungry for blood — keep the clock, the votes, and the night.</p>
        <div className="home-links">
          <Link to="/storyteller">Storyteller</Link>
          <Link to="/tv">Town Square</Link>
        </div>
      </div>
    </div>
  );
}
