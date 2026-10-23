import Link from "next/link";

export default function Home() {
  return (
    <main className="home">
      <div className="home__card">
        <p className="eyebrow">Household</p>
        <h1 className="home__title">
          Two phones,
          <br />
          one wall.
        </h1>
        <div className="home__routes">
          <Link className="home__route" href="/capture">
            <strong>Household</strong>
            <span>
              For a phone. Say it or photograph it — it lands in the calendar,
              the list or the notes on its own. Tap <em>Today</em> in the corner
              for the week, the list and anything waiting on you.
            </span>
          </Link>
          <Link className="home__route" href="/dashboard">
            <strong>Wall dashboard</strong>
            <span>
              For the tablet on the wall. The week, the list, the recipes, the
              budget, and anything that needs a look.
            </span>
          </Link>
          <Link className="home__route" href="/settings">
            <strong>Settings</strong>
            <span>Connect each person&rsquo;s Google and Outlook accounts.</span>
          </Link>
        </div>
        <p className="setting__note">
          Add each route to a home screen from Safari&rsquo;s share sheet to get it
          full-screen with no browser chrome.
        </p>
      </div>
    </main>
  );
}
