type Location = {
  name: string;
  address: string;
  neighborhood: string;
  phone: string;
  mapsHref: string;
};

const LOCATIONS: Location[] = [
  {
    name: "Breadtalk IHQ",
    neighborhood: "Tai Seng",
    address: "30 Tai Seng St, #08-04 BreadTalk IHQ, Singapore 534013",
    phone: "+6582067247",
    mapsHref: "https://maps.app.goo.gl/sGWsxE5t5JZk2dYL8",
  },
  {
    name: "Outram Park",
    neighborhood: "Chinatown",
    address: "6 Bukit Pasoh Rd, #02-01, Singapore 089820",
    phone: "+6582067247",
    mapsHref: "https://maps.app.goo.gl/zHiQ95j2geE7CJfy9",
  },
];

function formatPhone(phone: string) {
  // +6582067247 -> +65 8206 7247
  if (phone.startsWith("+65") && phone.length === 11) {
    return `+65 ${phone.slice(3, 7)} ${phone.slice(7)}`;
  }
  return phone;
}

export function Locations() {
  return (
    <section className="py-16 sm:py-20 border-t border-b border-border bg-paper">
      <div className="max-w-[1280px] mx-auto px-6 sm:px-8">
        <div className="text-center mb-10">
          <p className="text-[12px] font-bold uppercase tracking-wider text-accent-deep mb-3">
            Two studios, one practice
          </p>
          <h2 className="text-3xl sm:text-4xl font-serif text-ink">
            Visit us in Singapore
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 sm:gap-6 max-w-3xl mx-auto">
          {LOCATIONS.map((loc) => (
            <article
              key={loc.name}
              className="flex items-start gap-4 p-6 rounded-lg border border-border bg-card hover:border-accent hover:shadow-hover transition-all duration-200"
            >
              <div className="shrink-0 w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent-deep">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted mb-1">
                  {loc.neighborhood}
                </p>
                <h3 className="text-lg font-serif text-ink mb-1">{loc.name}</h3>
                <p className="text-[13px] text-muted leading-relaxed mb-3">
                  {loc.address}
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <a
                    href={loc.mapsHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-inverse text-[12px] font-bold hover:bg-accent-deep transition-colors"
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    Open in Maps
                  </a>
                  <a
                    href={`tel:${loc.phone}`}
                    className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink hover:text-accent-deep transition-colors"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z" />
                    </svg>
                    {formatPhone(loc.phone)}
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
