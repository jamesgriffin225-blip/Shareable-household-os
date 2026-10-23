import type { Profile } from "@/lib/types";

/**
 * Google and Microsoft refresh tokens die on their own — a revoked grant, a
 * changed password, or an OAuth app still in Google's "testing" mode, where
 * they expire every seven days.
 *
 * What lands on the wall when that happens used to be the provider's own
 * sentence ("Token has been expired or revoked"), which tells a person nothing
 * about what to do. There is exactly one cure, so the banner is the cure:
 * a button per person that starts consent for them. It carries the profile in
 * the URL because nothing on the wall is signed in as anybody.
 */
export default function ReconnectBanner({
  reconnect,
  profiles,
  provider = "google",
}: {
  reconnect: string[];
  profiles: Profile[];
  provider?: "google" | "microsoft";
}) {
  if (reconnect.length === 0) return null;

  const label = provider === "google" ? "Google" : "Outlook";
  const nameOf = (profileId: string) =>
    profiles.find((profile) => profile.id === profileId)?.name ?? profileId;

  return (
    <div className="banner banner--reconnect">
      <span>
        {reconnect.length === 1
          ? `${nameOf(reconnect[0])}'s ${label} sign-in has expired.`
          : `Both ${label} sign-ins have expired.`}{" "}
        The calendar will be out of date until it is renewed.
      </span>
      <span className="banner__actions">
        {reconnect.map((profileId) => (
          <a
            key={profileId}
            className="btn btn--primary"
            href={`/api/auth/${provider}?profile=${encodeURIComponent(profileId)}`}
          >
            Reconnect {nameOf(profileId)}
          </a>
        ))}
      </span>
    </div>
  );
}
