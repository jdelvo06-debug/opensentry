import { useEffect, useRef } from "react";

interface Props {
  onScenarioLaunch: (scenarioId: string) => void;
  onCustomMission: () => void;
  onBDA: () => void;
  onFeedback: () => void;
  onStudy: () => void;
}

const SCENARIOS = [
  {
    id: "tutorial",
    name: "TUTORIAL",
    description:
      "Guided walkthrough of the full DTID kill chain. Learn the interface, sensors, and engagement sequence.",
    difficulty: "BEGINNER",
    badgeClass: "badge-tutorial",
    duration: "5 min",
    meta: ["Guided walkthrough", "Single threat"],
  },
  {
    id: "lone_wolf",
    name: "LONE WOLF",
    description:
      "Single hostile UAS inbound. Detect, identify, and neutralize before breach.",
    difficulty: "EASY",
    badgeClass: "badge-easy",
    duration: "10 min",
    meta: ["Single commercial quad", "Direct approach"],
  },
  {
    id: "swarm_attack",
    name: "SWARM ATTACK",
    description:
      "Multi-vector swarm assault including Shahed-class threats. Triage targets, manage effector economy.",
    difficulty: "HARD",
    badgeClass: "badge-hard",
    duration: "15 min",
    meta: ["Multiple UAS", "Shahed-class threats"],
  },
  {
    id: "recon_probe",
    name: "RECON PROBE",
    description:
      "Mixed contacts with ambiguous intent. Apply ROE, identify hostiles, avoid fratricide.",
    difficulty: "MEDIUM",
    badgeClass: "badge-medium",
    duration: "12 min",
    meta: ["Fixed-wing surveillance", "ROE discipline"],
  },
  {
    id: "thermopylae",
    name: "THERMOPYLAE",
    description:
      "Unscripted free-play. Three escalating phases then endless chaos. End when you're done.",
    difficulty: "VARIABLE",
    badgeClass: "badge-medium",
    duration: "20+ min",
    meta: ["Escalating phases", "Endless mode"],
  },
  {
    id: "free_play",
    name: "FREE PLAY",
    description:
      "Open sandbox — steady mixed threats, one of each system, no timer. Practice at your own pace.",
    difficulty: "CASUAL",
    badgeClass: "badge-tutorial",
    duration: "\u221E",
    meta: ["Mixed threats", "No timer"],
  },
];

const FEATURES = [
  {
    icon: "\uD83C\uDFAF",
    title: "Detect",
    desc: "Multi-sensor detection — L-Band radar, EO/IR camera, RF spectrum. Terrain-aware line of sight and FOV modeling.",
  },
  {
    icon: "\uD83D\uDCE1",
    title: "Track",
    desc: "Confirm and correlate sensor hits into tracks. Build confidence through multi-sensor fusion before engagement.",
  },
  {
    icon: "\uD83D\uDD0D",
    title: "Identify",
    desc: "Visual ID via EO/IR camera, RF signature analysis, behavioral profiling. Determine hostile, friendly, or unknown.",
  },
  {
    icon: "\u2694\uFE0F",
    title: "Defeat",
    desc: "RF jamming, PNT denial, Shenobi protocol manipulation, JACKAL kinetic intercept. Match effector to threat.",
  },
];

export default function LandingPage({
  onScenarioLaunch,
  onCustomMission,
  onBDA,
  onFeedback,
  onStudy,
}: Props) {
  const navRef = useRef<HTMLElement>(null);
  const revealRefs = useRef<HTMLElement[]>([]);

  useEffect(() => {
    const handleScroll = () => {
      if (navRef.current) {
        navRef.current.classList.toggle("lp-nav--scrolled", window.scrollY > 40);
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("lp-reveal--visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    );
    for (const el of revealRefs.current) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  const addRevealRef = (el: HTMLElement | null) => {
    if (el && !revealRefs.current.includes(el)) {
      revealRefs.current.push(el);
    }
  };

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="lp">
      {/* Scanlines */}
      <div className="lp-scanlines" aria-hidden="true" />

      {/* Nav */}
      <nav ref={navRef} className="lp-nav">
        <div className="lp-container lp-nav__inner">
          <button className="lp-nav__brand" onClick={() => scrollTo("lp-hero")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 2v20M2 12h20" />
              <circle cx="12" cy="12" r="4" fill="currentColor" opacity="0.3" />
            </svg>
            OPENSENTRY
          </button>
          <ul className="lp-nav__links">
            <li><button onClick={() => scrollTo("lp-features")}>Features</button></li>
            <li><button onClick={() => scrollTo("lp-scenarios")}>Scenarios</button></li>
            <li><button onClick={() => onStudy()} className="lp-nav__cta">Training Library</button></li>
          </ul>
        </div>
      </nav>

      {/* Hero */}
      <section className="lp-hero" id="lp-hero">
        <div className="lp-hero__radar" aria-hidden="true">
          <div className="lp-radar-ring" />
          <div className="lp-radar-ring" />
          <div className="lp-radar-ring" />
          <div className="lp-radar-ring" />
          <div className="lp-radar-crosshair-h" />
          <div className="lp-radar-crosshair-v" />
          <div className="lp-radar-sweep" />
        </div>
        <div className="lp-hero__grid" aria-hidden="true" />
        <div className="lp-hero__content">
          <div className="lp-hero__classification">UNCLASSIFIED</div>
          <h1 className="lp-hero__title">OPENSENTRY</h1>
          <p className="lp-hero__subtitle">C-UAS Training Simulator</p>
          <p className="lp-hero__tagline">
            Train the DTID kill chain &mdash; Detect, Track, Identify, Defeat &mdash;
            in a realistic browser-based tactical operations environment.
          </p>
          <div className="lp-hero__buttons">
            <button className="lp-btn lp-btn--primary" onClick={() => scrollTo("lp-scenarios")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Launch Simulator
            </button>
            <a
              href="https://github.com/jdelvo06-debug/opensentry"
              target="_blank"
              rel="noopener noreferrer"
              className="lp-btn lp-btn--secondary"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
              </svg>
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="lp-stats">
        <div className="lp-container lp-stats__inner">
          <div className="lp-stat" ref={addRevealRef}>
            <span className="lp-stat__value">4</span>
            <span className="lp-stat__label">Kill Chain Phases</span>
          </div>
          <div className="lp-stat" ref={addRevealRef}>
            <span className="lp-stat__value">98</span>
            <span className="lp-stat__label">Base Presets</span>
          </div>
          <div className="lp-stat" ref={addRevealRef}>
            <span className="lp-stat__value">6</span>
            <span className="lp-stat__label">Scenarios</span>
          </div>
          <div className="lp-stat" ref={addRevealRef}>
            <span className="lp-stat__value">$0</span>
            <span className="lp-stat__label">Cost</span>
          </div>
          <div className="lp-stat" ref={addRevealRef}>
            <span className="lp-stat__value">0</span>
            <span className="lp-stat__label">Clearance Required</span>
          </div>
        </div>
      </section>

      {/* Features — DTID kill chain */}
      <section className="lp-features" id="lp-features">
        <div className="lp-container">
          <div className="lp-section-header lp-reveal" ref={addRevealRef}>
            <div className="lp-section-label">Capabilities</div>
            <h2 className="lp-section-title">The DTID Kill Chain</h2>
            <p className="lp-section-desc">
              Four phases, realistic decision points, and full sensor/effector modeling.
            </p>
          </div>
          <div className="lp-features__grid">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className="lp-feature-card lp-reveal"
                ref={addRevealRef}
                style={{ transitionDelay: `${i * 0.08}s` }}
              >
                <div className="lp-feature-card__icon">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Scenarios */}
      <section className="lp-scenarios" id="lp-scenarios">
        <div className="lp-container">
          <div className="lp-section-header lp-reveal" ref={addRevealRef}>
            <div className="lp-section-label">Training</div>
            <h2 className="lp-section-title">Scenarios</h2>
            <p className="lp-section-desc">
              Progressive training from first contact to complex multi-threat engagements.
            </p>
          </div>
          <div className="lp-scenarios__grid">
            {SCENARIOS.map((sc, i) => (
              <div
                key={sc.id}
                className="lp-scenario-card lp-reveal"
                ref={addRevealRef}
                style={{ transitionDelay: `${i * 0.06}s` }}
              >
                <div className="lp-scenario-card__header">
                  <h3>{sc.name}</h3>
                  <span className={`lp-badge ${sc.badgeClass}`}>{sc.difficulty}</span>
                </div>
                <p className="lp-scenario-card__desc">{sc.description}</p>
                <div className="lp-scenario-card__meta">
                  {sc.meta.map((m) => (
                    <span key={m}>{m}</span>
                  ))}
                  <span>{sc.duration}</span>
                </div>
                <button
                  className="lp-scenario-card__launch"
                  onClick={() => onScenarioLaunch(sc.id)}
                >
                  LAUNCH
                </button>
              </div>
            ))}
          </div>

          {/* CTAs */}
          <div className="lp-ctas lp-reveal" ref={addRevealRef}>
            <button className="lp-btn lp-btn--outline" onClick={onCustomMission}>
              CUSTOM MISSION
            </button>
            <button className="lp-btn lp-btn--outline lp-btn--gold" onClick={onBDA}>
              BASE DEFENSE ARCHITECT
              <span className="lp-beta-badge">BETA</span>
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="lp-footer">
        <div className="lp-container">
          <div className="lp-footer__classification">UNCLASSIFIED // OPEN SOURCE</div>
          <p>OpenSentry is unclassified and open source. Built for training purposes only.</p>
          <p>No real-world systems, classified data, or controlled technical information.</p>
          <div className="lp-footer__links">
            <button onClick={onFeedback}>Feedback</button>
            <a
              href="https://github.com/jdelvo06-debug/opensentry#readme"
              target="_blank"
              rel="noopener noreferrer"
            >
              Documentation
            </a>
            <button onClick={onStudy}>Training Library</button>
          </div>
          <p className="lp-footer__free">FREE FOREVER.</p>
        </div>
      </footer>
    </div>
  );
}
