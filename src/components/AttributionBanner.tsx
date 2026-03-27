const socialLinks = [
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/in/alparslanguvenc/",
    monogram: "in",
  },
  {
    label: "ORCID",
    href: "https://orcid.org/0000-0002-6195-0654",
    monogram: "iD",
  },
  {
    label: "X",
    href: "https://x.com/AlparslanGvnc",
    monogram: "X",
  },
];

export const AttributionBanner = () => (
  <section className="attribution-banner">
    <p className="attribution-banner__text">
      bu program tüm sınav koordinatörlerinin işlerini kolaylaştırmak için ALPARSLAN GÜVENÇ
      tarafından geliştirilmiştir
    </p>

    <div className="attribution-banner__links">
      {socialLinks.map((link) => (
        <a
          key={link.label}
          className="social-link"
          href={link.href}
          target="_blank"
          rel="noreferrer"
          aria-label={link.label}
          title={link.label}
        >
          <span className="social-link__badge" aria-hidden="true">
            {link.monogram}
          </span>
          <span>{link.label}</span>
        </a>
      ))}
    </div>
  </section>
);
