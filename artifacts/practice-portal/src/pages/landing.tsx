import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Briefcase, ArrowRight, ShieldCheck, Scale, Globe, PenLine, Lock } from "lucide-react";

/**
 * Reveals a block once it has been on screen.
 *
 * `once: true` in spirit — the observer disconnects on the first intersection,
 * so a section does not fade out again when scrolled past and back. Re-playing
 * on every pass is the thing that makes scroll animation tiring rather than
 * pleasant.
 *
 * When IntersectionObserver is missing the element is shown immediately, which
 * is the only safe failure: an entrance animation that never fires would leave
 * the page blank.
 */
function useReveal<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      // A little before it reaches the fold, so the motion finishes as the
      // reader arrives rather than starting then.
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return [ref, shown];
}

/** A hero block that rises on mount rather than on scroll — it is already in view. */
function useMountReveal(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    // One frame, so the browser paints the "before" state and the transition
    // has something to run from. Setting it synchronously skips the animation.
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return shown;
}

const FEATURES = [
  {
    icon: Scale,
    title: "The matter, end to end",
    body: "Cause list, hearings, tasks and time against one file. Conflict checks on every new party, and an audit trail that cannot be edited — because the question later is always who saw what, and when.",
  },
  {
    icon: Briefcase,
    title: "A portal your client can read",
    body: "Documents encrypted at rest, released only through an authorisation check. Clients see their own matter and nothing else. Nobody outside the chamber sees anything at all.",
  },
  {
    icon: PenLine,
    title: "Drafting on your own record",
    body: "Petitions, replies and case briefs written from the chamber's own files and in the chamber's own style. Off by default; switched on deliberately, and every draft is recorded.",
  },
  {
    icon: Globe,
    title: "Built for Indian practice",
    body: "Rupees in paise, never floats. Gapless invoice numbering. Court listings from the forums you actually appear before, matched to your matters.",
  },
];

export default function LandingPage() {
  const heroShown = useMountReveal();
  const [featuresRef, featuresShown] = useReveal<HTMLDivElement>();
  const [closingRef, closingShown] = useReveal<HTMLDivElement>();

  return (
    // `data-landing` is what scopes every animation in index.css to this page.
    // Remove it and the page renders identically, just still.
    <div
      data-landing
      className="min-h-screen bg-background text-foreground flex flex-col font-sans"
    >
      <header className="min-h-20 border-b border-border flex flex-wrap items-center justify-between gap-y-2 py-3 sm:py-0 px-4 sm:px-8 relative z-10 bg-background/80 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-primary text-primary-foreground flex items-center justify-center font-mono font-bold text-lg tracking-tighter shadow-sm">
            LEX
          </div>
          <span className="font-mono font-bold tracking-tight text-xl">PRACTICE</span>
        </div>
        <div className="flex gap-2 sm:gap-4 items-center">
          <Link
            href="/portal"
            className="text-sm font-semibold hover:text-primary transition-colors px-4 py-2"
          >
            Sign in
          </Link>
          <Link
            href="/portal?new=1"
            className="text-sm font-semibold bg-primary text-primary-foreground px-4 sm:px-6 py-2.5 shadow-sm hover:bg-primary/90 transition-all active:scale-95 border border-primary"
          >
            Set up a chamber
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col relative overflow-hidden">
        {/* The colour field. Static blobs before; now drifting slowly enough to
            be felt rather than watched. `will-change` is deliberately absent —
            on a full-page blur it costs more in memory than it saves. */}
        <div className="drift-a absolute top-0 right-0 w-[800px] h-[800px] bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
        <div className="drift-b absolute bottom-0 left-0 w-[600px] h-[600px] bg-secondary/50 rounded-full blur-3xl translate-y-1/3 -translate-x-1/3 pointer-events-none" />

        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPgo8cmVjdCB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSJub25lIiAvPgo8cmVjdCB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJjdXJyZW50Q29sb3IiIG9wYWNpdHk9IjAuMDUiIC8+Cjwvc3ZnPg==')] pointer-events-none z-0" />

        <div className="flex-1 flex flex-col justify-center max-w-6xl mx-auto w-full px-6 sm:px-8 py-20 sm:py-28 relative z-10">
          <div className="max-w-3xl">
            {/* Each block carries its own delay, so they arrive in reading
                order about 90ms apart rather than all at once. */}
            <div
              className={`rise ${heroShown ? "shown" : ""} inline-flex items-center gap-2 px-3 py-1 rounded-[var(--radius)] bg-card shadow-sm mb-8`}
              style={{ "--d": "0ms" } as React.CSSProperties}
            >
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span className="text-xs font-mono font-semibold tracking-wider uppercase text-muted-foreground">
                Invite-only · For Indian chambers
              </span>
            </div>

            <h1
              className={`rise ${heroShown ? "shown" : ""} text-5xl sm:text-7xl md:text-8xl font-bold tracking-tighter mb-8 leading-[1.05]`}
              style={{ "--d": "90ms" } as React.CSSProperties}
            >
              Precision.
              <br />
              <span className="text-muted-foreground">Discretion.</span>
              <br />
              Advocacy.
            </h1>

            <p
              className={`rise ${heroShown ? "shown" : ""} text-xl md:text-2xl text-muted-foreground mb-10 max-w-2xl font-light leading-relaxed`}
              style={{ "--d": "180ms" } as React.CSSProperties}
            >
              Chamber management for advocates who hold privileged material: matters, cause list,
              tasks, time and invoicing — with a client portal that shows a client their own file
              and nothing else.
            </p>

            <div
              className={`rise ${heroShown ? "shown" : ""} flex flex-wrap gap-4`}
              style={{ "--d": "270ms" } as React.CSSProperties}
            >
              {/* Single front door. Everyone — staff and clients alike — signs in
                  through the same layer and is sorted by the access list. */}
              <Link
                href="/portal"
                className="lift inline-flex items-center justify-center gap-2 bg-foreground text-background px-8 py-4 text-lg font-semibold hover:bg-foreground/90 border border-foreground shadow-sm"
              >
                Chamber portal
                <ArrowRight className="h-5 w-5" />
              </Link>
              <Link
                href="/portal?new=1"
                className="lift inline-flex items-center justify-center gap-2 bg-background text-foreground px-8 py-4 text-lg font-semibold border border-border hover:bg-accent shadow-sm"
              >
                Set up a chamber
              </Link>
            </div>

            <p
              className={`rise ${heroShown ? "shown" : ""} mt-6 text-sm text-muted-foreground max-w-xl`}
              style={{ "--d": "360ms" } as React.CSSProperties}
            >
              Sign in with Google, Zoho Mail, or a one-time code to your email or mobile — there is
              no password to lose. Admins and senior advocates set up a chamber; everyone else joins
              by invitation from their chamber's admin.
            </p>
          </div>
        </div>

        <div
          ref={featuresRef}
          className="border-t border-border bg-card/50 backdrop-blur-sm py-16 sm:py-20 relative z-10"
        >
          <div className="max-w-6xl mx-auto px-6 sm:px-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-10">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className={`rise ${featuresShown ? "shown" : ""} lift flex flex-col gap-4 rounded-[var(--radius)] p-5 -m-1 hover:bg-background/60 hover:shadow-md`}
                style={{ "--d": `${i * 80}ms` } as React.CSSProperties}
              >
                <f.icon className="h-8 w-8 text-primary" />
                <h3 className="text-lg font-bold tracking-tight">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* The closing line does the work the three cards used to: it says what
            kind of thing this is, for someone who scrolled to the bottom
            deciding whether to write to us. */}
        <div ref={closingRef} className="border-t border-border py-16 relative z-10">
          <div
            className={`rise ${closingShown ? "shown" : ""} max-w-6xl mx-auto px-6 sm:px-8 flex flex-col md:flex-row md:items-center gap-6 justify-between`}
          >
            <div className="flex items-start gap-4 max-w-xl">
              <Lock className="h-6 w-6 text-primary shrink-0 mt-1" />
              <p className="text-muted-foreground leading-relaxed">
                Documents are encrypted at rest and reachable only through an authorisation check.
                Every chamber is isolated from every other, and that isolation is re-tested on every
                change. What we do with data is set out in the{" "}
                <a
                  href="/legal/privacy"
                  className="underline underline-offset-4 hover:text-primary"
                >
                  privacy policy
                </a>
                .
              </p>
            </div>
            <Link
              href="/portal"
              className="lift inline-flex items-center justify-center gap-2 shrink-0 bg-foreground text-background px-6 py-3 font-semibold border border-foreground shadow-sm"
            >
              Go to the portal
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <footer className="border-t border-border py-8 relative z-10">
          <div className="max-w-6xl mx-auto px-6 sm:px-8 flex flex-wrap gap-x-6 gap-y-2 items-center justify-between text-xs font-mono uppercase tracking-widest text-muted-foreground">
            <span>LEX Practice</span>
            <div className="flex flex-wrap gap-x-5 gap-y-1 items-center">
              <a
                href="/legal/terms"
                className="hover:text-foreground inline-flex items-center min-h-10 px-1"
              >
                Terms
              </a>
              <a
                href="/legal/privacy"
                className="hover:text-foreground inline-flex items-center min-h-10 px-1"
              >
                Privacy
              </a>
              <a
                href="/legal/notice"
                className="hover:text-foreground inline-flex items-center min-h-10 px-1"
              >
                Data notice
              </a>
              <a
                href="/legal/dpa"
                className="hover:text-foreground inline-flex items-center min-h-10 px-1"
              >
                Processing
              </a>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
