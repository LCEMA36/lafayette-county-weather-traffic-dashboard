# Lafayette County Weather & Traffic Awareness Dashboard

A browser-based weather and traffic dashboard for Lafayette County, Mississippi.

Maintained by Beau Moore, Public Information Officer: [662.801.8323](tel:+16628018323) · [bmoore@lafayettecoms.com](mailto:bmoore@lafayettecoms.com).

## Included files

- `index.html` — the latest dashboard, with its styles and scripts included.
- `assets/lafayette-county-logo.png` — county logo converted from the supplied Illustrator artwork.
- `assets/lafayette-county-courthouse.jpg` — supplied courthouse photograph.

Keep the `assets` folder alongside `index.html`. No build step is required. Serve this folder through an HTTP/HTTPS static web server; opening it directly from disk can prevent some feeds from working.

## Features

Overview, NWS forecasts and alerts, SPC outlooks, KUOX current conditions, grouped Waze reports, NWS discussions, regional METAR observations, radar, and an email briefing prepared in the user's default mail application.

## Data and setup notes

- Weather data and imagery require an internet connection and depend on the availability of external NWS/NOAA services.
- KUOX observations are checked every three minutes. The source observation may be older than the latest check.
- Waze requires a separately configured same-origin `waze.json` feed or a proxy URL in `WAZE_CONFIG`. No private Waze partner URL or credentials are included. Keep credentials server-side and review Waze's sharing requirements before publishing traffic data.
- The current weather graphic uses NWS Memphis Graphicast slot `4.png`, checked every five minutes. The image in that slot can change; the dashboard does not automatically detect changes to which slot leads the NWS homepage.
- Summaries are rule-based excerpts and aggregates created in the browser, not calls to an AI model, despite the current alert-summary label. Official NWS products remain authoritative.
- Email actions prepare a draft; they do not send mail. Image links are included rather than embedded image attachments.
- Missing, delayed, or unavailable feeds must not be interpreted as an all-clear. Verify source timestamps and official warnings before operational decisions.

## Publication

The repository is public, and GitHub Pages publishes the dashboard from the root of the `main` branch.

**Live dashboard:** [Lafayette County Weather & Traffic Awareness Dashboard](https://lcema36.github.io/lafayette-county-weather-traffic-dashboard/)

Updates saved to `main` trigger a new website deployment. GitHub Pages serves the static dashboard over HTTPS; it does not run a server-side Waze proxy.

## Branding

County artwork and the supplied photograph are included for this dashboard. No additional redistribution license is granted by this repository.
