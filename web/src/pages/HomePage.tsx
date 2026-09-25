import { Link } from "react-router-dom";

export function HomePage() {
  return (
    <div className="home">
      <div>
        <h1 className="brand">Blood on the Clocktower</h1>
        <p>LAN companion for the storyteller phone and the town square TV.</p>
        <div className="home-links">
          <Link to="/storyteller">Storyteller</Link>
          <Link to="/tv">TV Display</Link>
        </div>
      </div>
    </div>
  );
}
